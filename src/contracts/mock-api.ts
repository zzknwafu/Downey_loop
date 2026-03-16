import { compareExperiments } from "../domain/comparison.js";
import { buildSampleExperiments, sampleDatasets, sampleEvaluators } from "../domain/sample-data.js";
import { TraceRun } from "../domain/types.js";
import {
  BootstrapPayload,
  EvalLoopApi,
  listTracesFromExperiments,
  toDatasetListItem,
  toEvaluatorListItem,
  toExperimentListItem,
} from "./api.js";

export const createMockEvalLoopApi = (): EvalLoopApi => {
  const { baseline, candidate } = buildSampleExperiments();
  const comparison = compareExperiments(baseline, candidate);
  const traces = listTracesFromExperiments([baseline, candidate]);

  const bootstrapPayload: BootstrapPayload = {
    datasets: sampleDatasets.map(toDatasetListItem),
    evaluators: sampleEvaluators.map(toEvaluatorListItem),
    experiments: [baseline, candidate].map(toExperimentListItem),
    comparison,
  };

  return {
    async bootstrap() {
      return bootstrapPayload;
    },
    async listDatasets() {
      return sampleDatasets;
    },
    async listEvaluators() {
      return sampleEvaluators;
    },
    async listExperiments() {
      return [baseline, candidate];
    },
    async getExperiment(experimentId: string) {
      return [baseline, candidate].find((experiment) => experiment.experimentId === experimentId);
    },
    async getComparison() {
      return comparison;
    },
    async getTrace(traceId: string): Promise<TraceRun | undefined> {
      return traces.find((trace) => trace.traceId === traceId);
    },
  };
};
