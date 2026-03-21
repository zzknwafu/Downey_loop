import {
  buildExperimentCaseRun,
  buildExperimentBasicInfo,
  buildExperimentConfigurationSnapshot,
  buildExperimentEvaluatorSet,
  createEmptyExperimentRun,
  summarizeExperimentRun,
} from "../domain/experiment.js";
import {
  CaseRunJob,
  Dataset,
  Evaluator,
  EvalCase,
  ExperimentCaseRun,
  ExperimentRun,
  ExperimentRunJob,
  PipelineExecutionResult,
  SearchPipelineVersion,
  StartExperimentInput,
  TraceRun,
} from "../domain/types.js";
import { toExecutionTarget, toTargetSelection } from "../domain/targets.js";

export type PipelineExecutor = (
  evalCase: EvalCase,
  target: SearchPipelineVersion,
) => Promise<PipelineExecutionResult>;

const now = () => new Date().toISOString();

export class CaseRunner {
  constructor(private readonly pipelineExecutor: PipelineExecutor) {}

  async runCase(evalCase: EvalCase, target: SearchPipelineVersion, evaluators: Evaluator[]) {
    try {
      const execution = await this.pipelineExecutor(evalCase, target);
      return buildExperimentCaseRun(evalCase, target, execution, evaluators);
    } catch (error) {
      return buildFailedExperimentCaseRun(evalCase, target, error, evaluators);
    }
  }
}

export class ExperimentRunner {
  private readonly caseRunner: CaseRunner;

  constructor(pipelineExecutor: PipelineExecutor) {
    this.caseRunner = new CaseRunner(pipelineExecutor);
  }

  createExperimentRunJob(
    experimentId: string,
    dataset: Dataset,
    _evaluators: Evaluator[],
  ): ExperimentRunJob {
    const createdAt = now();
    return {
      jobId: `job_${experimentId}`,
      experimentId,
      status: "queued",
      createdAt,
      caseJobs: dataset.cases.map((evalCase) => ({
        jobId: `case_job_${experimentId}_${evalCase.caseId}`,
        experimentId,
        caseId: evalCase.caseId,
        status: "queued",
      })),
    };
  }

  async runExperiment(input: StartExperimentInput): Promise<{
    experiment: ExperimentRun;
    job: ExperimentRunJob;
  }> {
    const experimentId = `exp_${input.target.id}_${Date.now()}`;
    const executionTarget = input.executionTarget ?? toExecutionTarget(input.target);
    const job = this.createExperimentRunJob(experimentId, input.dataset, input.evaluators);
    job.status = "running";
    job.startedAt = now();

    const concurrency = Math.max(1, input.runConfig?.concurrency ?? 1);
    const evalCaseMap = new Map(input.dataset.cases.map((evalCase) => [evalCase.caseId, evalCase]));
    const caseRuns: ExperimentRun["caseRuns"] = new Array(job.caseJobs.length);
    const nextCaseJobs: CaseRunJob[] = job.caseJobs.map((caseJob) => ({ ...caseJob, status: "queued" }));
    let nextIndex = 0;

    const worker = async () => {
      for (;;) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= job.caseJobs.length) {
          return;
        }

        const caseJob = job.caseJobs[currentIndex]!;
        nextCaseJobs[currentIndex] = { ...caseJob, status: "running" };
        const evalCase = evalCaseMap.get(caseJob.caseId);
        if (!evalCase) {
          const error = new Error(`Missing eval case: ${caseJob.caseId}`);
          caseRuns[currentIndex] = buildFailedExperimentCaseRun(
            {
              caseId: caseJob.caseId,
              answerReference: "",
              expectedRetrievalIds: [],
              acceptableRetrievalIds: [],
              expectedTopItems: [],
              retrievalCandidates: [],
              userQuery: "",
              domain: "food_delivery",
              taskType: "ai_search",
            } as EvalCase,
            executionTarget,
            error,
            input.evaluators,
          );
          nextCaseJobs[currentIndex] = {
            ...caseJob,
            status: "failed",
            error: error.message,
          };
          continue;
        }

        const caseRun = await this.caseRunner.runCase(evalCase, executionTarget, input.evaluators);
        caseRuns[currentIndex] = caseRun;
        nextCaseJobs[currentIndex] = {
          ...caseJob,
          status: caseRun.status === "runtime_error" ? "failed" : "completed",
          error:
            caseRun.status === "runtime_error"
              ? `Case ${caseJob.caseId} failed during execution`
              : undefined,
        };
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, job.caseJobs.length) }, worker));

    job.caseJobs = nextCaseJobs;
    job.finishedAt = now();
    job.status = nextCaseJobs.some((caseJob) => caseJob.status === "failed") ? "failed" : "completed";

    const summary = summarizeExperimentRun(caseRuns.filter((caseRun): caseRun is NonNullable<typeof caseRun> => Boolean(caseRun)));
    const status = job.status === "completed" ? "FINISHED" : "FAILED";
    const experiment = createEmptyExperimentRun(experimentId, input.target, executionTarget, {
      datasetId: input.dataset.id,
      evaluatorIds: input.evaluators.map((item) => item.id),
      evaluatorSet: buildExperimentEvaluatorSet(input.dataset, input.evaluators),
      targetRef: {
        id: input.target.id,
        type: input.targetSelection?.type ?? toTargetSelection(input.target).type,
        version: input.target.version,
      },
      targetSelection: input.targetSelection ?? toTargetSelection(input.target),
      pipelineVersionId: executionTarget.id,
      status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      caseRuns,
      summary,
      basicInfo: buildExperimentBasicInfo({
        dataset: input.dataset,
        target: input.target,
        evaluators: input.evaluators,
        summary,
        status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      }),
      configuration: buildExperimentConfigurationSnapshot({
        dataset: input.dataset,
        target: input.target,
        evaluators: input.evaluators,
        promptBinding: input.promptBinding,
        runConfig: input.runConfig,
      }),
    });

    return { experiment, job };
  }
}

const buildFailedExperimentCaseRun = (
  evalCase: EvalCase,
  target: SearchPipelineVersion,
  error: unknown,
  evaluators: Evaluator[],
): ExperimentCaseRun => {
  const message = error instanceof Error ? error.message : "Unknown runner error";
  const trace: TraceRun = {
    traceId: `${target.id}_${evalCase.caseId}`,
    caseId: evalCase.caseId,
    retrievalTrace: {
      layer: "retrieval",
      latencyMs: 0,
      inputs: {},
      outputs: {},
    },
    rerankTrace: {
      layer: "rerank",
      latencyMs: 0,
      inputs: {},
      outputs: {},
    },
    answerTrace: {
      layer: "answer",
      latencyMs: 0,
      inputs: {},
      outputs: { answerOutput: "", error: message },
    },
    error: message,
  };

  return {
    caseId: evalCase.caseId,
    targetId: target.id,
    status: "runtime_error" as const,
    output: "",
    scores: [],
    traceId: trace.traceId,
    trace,
    layerRuns: [
      { caseId: evalCase.caseId, layer: "retrieval" as const, outputs: {} },
      { caseId: evalCase.caseId, layer: "rerank" as const, outputs: {} },
      { caseId: evalCase.caseId, layer: "answer" as const, outputs: { error: message } },
      { caseId: evalCase.caseId, layer: "overall" as const, outputs: { error: message } },
    ],
    layerMetrics: [],
  };
};
