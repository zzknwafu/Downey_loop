import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.join(workspaceRoot, '.cache', 'coze-loop');
const outputRoot = path.join(workspaceRoot, 'artifacts', 'coze-loop-oss');
const dockerComposeRoot = path.join(repoRoot, 'release', 'deployment', 'docker-compose');

const rawAssetSpecs = [
  {
    kind: 'config',
    relativePath: path.join('conf', 'evaluation.yaml'),
  },
  {
    kind: 'config',
    relativePath: path.join('conf', 'prompt.yaml'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'evaluator_template.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'dataset.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'dataset_item.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'dataset_schema.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'dataset_version.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'dataset_item_snapshot.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'dataset_io_job.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'prompt_basic.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'prompt_commit.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'prompt_user_draft.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'prompt_label.sql'),
  },
  {
    kind: 'sql',
    relativePath: path.join('bootstrap', 'mysql-init', 'init-sql', 'prompt_relation.sql'),
  },
];

const evaluatorColumns = [
  'id',
  'space_id',
  'evaluator_type',
  'name',
  'description',
  'metainfo',
  'receive_chat_history',
  'input_schema',
  'output_schema',
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function decodeSqlString(value) {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    const current = value[i];
    const next = value[i + 1];
    if (current === '\\' && next !== undefined) {
      result += next;
      i += 1;
      continue;
    }
    result += current;
  }
  return result;
}

function parseSqlToken(token) {
  const trimmed = token.trim();
  if (trimmed === 'NULL') {
    return null;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return decodeSqlString(trimmed.slice(1, -1));
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function splitSqlFields(tupleBody) {
  const fields = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < tupleBody.length; i += 1) {
    const char = tupleBody[i];
    const next = tupleBody[i + 1];

    if (char === '\\' && inQuote && next !== undefined) {
      current += char + next;
      i += 1;
      continue;
    }

    if (char === "'") {
      inQuote = !inQuote;
      current += char;
      continue;
    }

    if (char === ',' && !inQuote) {
      fields.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    fields.push(current.trim());
  }

  return fields;
}

function extractSqlTuples(valuesSql) {
  const tuples = [];
  let inQuote = false;
  let depth = 0;
  let current = '';

  for (let i = 0; i < valuesSql.length; i += 1) {
    const char = valuesSql[i];
    const next = valuesSql[i + 1];

    if (char === '\\' && inQuote && next !== undefined) {
      current += char + next;
      i += 1;
      continue;
    }

    if (char === "'") {
      inQuote = !inQuote;
      current += char;
      continue;
    }

    if (!inQuote && char === '(') {
      depth += 1;
      current += char;
      continue;
    }

    if (!inQuote && char === ')') {
      depth -= 1;
      current += char;
      if (depth === 0) {
        tuples.push(current.trim());
        current = '';
      }
      continue;
    }

    if (depth > 0) {
      current += char;
    }
  }

  return tuples;
}

function safeJsonParse(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseEvaluatorTemplates(sqlText) {
  const insertMarker = 'INSERT INTO `evaluator_template`';
  const duplicateMarker = 'ON DUPLICATE KEY UPDATE';
  const insertIndex = sqlText.indexOf(insertMarker);
  if (insertIndex === -1) {
    throw new Error('Unable to find evaluator_template insert block.');
  }

  const duplicateIndex = sqlText.indexOf(duplicateMarker, insertIndex);
  if (duplicateIndex === -1) {
    throw new Error('Unable to find evaluator_template ON DUPLICATE KEY UPDATE block.');
  }

  const insertBlock = sqlText.slice(insertIndex, duplicateIndex);
  const valuesIndex = insertBlock.indexOf('VALUES');
  if (valuesIndex === -1) {
    throw new Error('Unable to find VALUES block in evaluator_template.sql.');
  }

  const valuesSql = insertBlock.slice(valuesIndex + 'VALUES'.length);
  const tupleTexts = extractSqlTuples(valuesSql);

  return tupleTexts.map((tupleText) => {
    const tupleBody = tupleText.slice(1, -1);
    const fields = splitSqlFields(tupleBody);
    const row = Object.fromEntries(
      evaluatorColumns.map((column, index) => [column, parseSqlToken(fields[index])]),
    );
    const evaluatorType =
      row.evaluator_type === null || row.evaluator_type === undefined
        ? null
        : Number(row.evaluator_type);
    const receiveChatHistory =
      row.receive_chat_history === null || row.receive_chat_history === undefined
        ? false
        : Number(row.receive_chat_history) === 1;

    const metainfo = safeJsonParse(row.metainfo);
    const inputSchema = safeJsonParse(row.input_schema);
    const outputSchema = safeJsonParse(row.output_schema);

    return {
      id: String(row.id),
      space_id: row.space_id === null ? null : String(row.space_id),
      evaluator_type: evaluatorType,
      evaluator_type_label:
        evaluatorType === 1 ? 'llm' : evaluatorType === 2 ? 'code' : 'unknown',
      name: row.name,
      description: row.description,
      receive_chat_history: receiveChatHistory,
      input_schema: inputSchema,
      output_schema: outputSchema,
      metainfo,
      prompt_text:
        Array.isArray(metainfo?.message_list)
          ? metainfo.message_list
              .map((item) => item?.content?.text)
              .filter(Boolean)
              .join('\n\n')
          : null,
      js_code: metainfo?.lang_2_code_content?.JS ?? null,
      python_code: metainfo?.lang_2_code_content?.Python ?? null,
    };
  });
}

function copyRawAssets() {
  return rawAssetSpecs.map((spec) => {
    const sourcePath = path.join(dockerComposeRoot, spec.relativePath);
    const targetPath = path.join(outputRoot, 'raw', spec.relativePath);
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
    const content = fs.readFileSync(sourcePath, 'utf8');
    return {
      kind: spec.kind,
      source_path: sourcePath,
      output_path: targetPath,
      bytes: Buffer.byteLength(content),
      has_insert_statements: /\bINSERT\s+INTO\b/i.test(content),
    };
  });
}

function buildManifest(rawAssets, evaluatorTemplates) {
  const llmTemplates = evaluatorTemplates.filter((item) => item.evaluator_type_label === 'llm');
  const codeTemplates = evaluatorTemplates.filter((item) => item.evaluator_type_label === 'code');

  return {
    extracted_at: new Date().toISOString(),
    source_repo_path: repoRoot,
    source_repo_url: 'https://github.com/coze-dev/coze-loop',
    output_path: outputRoot,
    summary: {
      raw_asset_count: rawAssets.length,
      evaluator_template_count: evaluatorTemplates.length,
      llm_template_count: llmTemplates.length,
      code_template_count: codeTemplates.length,
    },
    findings: [
      'OSS repo contains built-in evaluator prompt templates and code evaluator templates.',
      'OSS repo includes dataset/prompt related SQL schemas and service code.',
      'No ready-made business dataset rows or prompt rows were found in the published SQL bootstrap files copied here.',
    ],
    raw_assets: rawAssets,
    llm_template_names: llmTemplates.map((item) => item.name),
    code_template_names: codeTemplates.map((item) => item.name),
  };
}

function buildReadme(manifest) {
  const llmTemplates = manifest.llm_template_names.map((name) => `- ${name}`).join('\n');
  const codeTemplates = manifest.code_template_names.map((name) => `- ${name}`).join('\n');

  return `# Coze Loop OSS assets

Source repo: ${manifest.source_repo_url}
Local clone: ${manifest.source_repo_path}
Extracted output: ${manifest.output_path}

## Summary

- Raw copied files: ${manifest.summary.raw_asset_count}
- Evaluator templates: ${manifest.summary.evaluator_template_count}
- LLM evaluator templates: ${manifest.summary.llm_template_count}
- Code evaluator templates: ${manifest.summary.code_template_count}

## What is included

- Docker Compose bootstrap/config files related to evaluation, datasets, and prompts under \`raw/\`
- Parsed evaluator prompt templates in \`evaluator-templates.json\`
- Machine-readable asset summary in \`manifest.json\`

## What is not included

- Ready-made business dataset rows exported from production
- Ready-made prompt rows from \`prompt_commit\` or related tables

The open-source repository exposes schema and bootstrap templates, but the copied SQL files here do not include populated business datasets/prompts.

## LLM evaluator templates

${llmTemplates}

## Code evaluator templates

${codeTemplates}
`;
}

function main() {
  if (!fs.existsSync(repoRoot)) {
    throw new Error(`Missing cloned repo: ${repoRoot}`);
  }

  ensureDir(outputRoot);
  const rawAssets = copyRawAssets();

  const evaluatorSqlPath = path.join(
    dockerComposeRoot,
    'bootstrap',
    'mysql-init',
    'init-sql',
    'evaluator_template.sql',
  );
  const evaluatorSql = fs.readFileSync(evaluatorSqlPath, 'utf8');
  const evaluatorTemplates = parseEvaluatorTemplates(evaluatorSql);
  const manifest = buildManifest(rawAssets, evaluatorTemplates);
  const readme = buildReadme(manifest);

  fs.writeFileSync(
    path.join(outputRoot, 'evaluator-templates.json'),
    `${JSON.stringify(evaluatorTemplates, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputRoot, 'README.md'), readme);

  console.log(
    JSON.stringify(
      {
        output_path: outputRoot,
        evaluator_templates: evaluatorTemplates.length,
        llm_templates: manifest.summary.llm_template_count,
        code_templates: manifest.summary.code_template_count,
      },
      null,
      2,
    ),
  );
}

main();
