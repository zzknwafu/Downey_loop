import { buildExperimentCaseRun, createEmptyExperimentRun, summarizeExperimentRun } from "../domain/experiment.js";
import {
  CaseRunJob,
  Dataset,
  EvalCase,
  Evaluator,
  ExperimentRun,
  ExperimentRunJob,
  PipelineExecutionResult,
  SearchPipelineVersion,
  StartExperimentInput,
} from "../domain/types.js";

export type PipelineExecutor = (
  evalCase: EvalCase,
  target: SearchPipelineVersion,
) => Promise<PipelineExecutionResult>;

const now = () => new Date().toISOString();

export class CaseRunner {
  constructor(private readonly pipelineExecutor: PipelineExecutor) {}

  async runCase(evalCase: EvalCase, target: SearchPipelineVersion) {
    const execution = await this.pipelineExecutor(evalCase, target);
    return buildExperimentCaseRun(evalCase, target, execution);
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
    const job = this.createExperimentRunJob(experimentId, input.dataset, input.evaluators);
    job.status = "running";
    job.startedAt = now();

    const caseRuns = [];
    const nextCaseJobs: CaseRunJob[] = [];

    for (const caseJob of job.caseJobs) {
      nextCaseJobs.push({ ...caseJob, status: "running" });
      try {
        const evalCase = input.dataset.cases.find((item) => item.caseId === caseJob.caseId);
        if (!evalCase) {
          throw new Error(`Missing eval case: ${caseJob.caseId}`);
        }

        const caseRun = await this.caseRunner.runCase(evalCase, input.target);
        caseRuns.push(caseRun);
        nextCaseJobs[nextCaseJobs.length - 1] = { ...caseJob, status: "completed" };
      } catch (error) {
        nextCaseJobs[nextCaseJobs.length - 1] = {
          ...caseJob,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown runner error",
        };
      }
    }

    job.caseJobs = nextCaseJobs;
    job.finishedAt = now();
    job.status = nextCaseJobs.some((caseJob) => caseJob.status === "failed") ? "failed" : "completed";

    const experiment = createEmptyExperimentRun(experimentId, input.target, {
      datasetId: input.dataset.id,
      evaluatorIds: input.evaluators.map((item) => item.id),
      targetRef: {
        id: input.target.id,
        type: "agent",
        version: input.target.version,
      },
      pipelineVersionId: input.target.id,
      status: job.status === "completed" ? "FINISHED" : "FAILED",
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      caseRuns,
      summary: summarizeExperimentRun(caseRuns),
    });

    return { experiment, job };
  }
}
