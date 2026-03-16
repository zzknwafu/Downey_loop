import { useEffect, useMemo, useState } from "react";
import { DemoViewModel, demoViewModel, loadRemoteDemoViewModel } from "./view-model.js";

const formatMetricValue = (value: number) => {
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(3);
};

const formatDelta = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;

export const App = () => {
  const [viewModel, setViewModel] = useState<DemoViewModel>(demoViewModel);
  const [syncState, setSyncState] = useState<"syncing" | "ready" | "fallback">("syncing");

  useEffect(() => {
    let active = true;

    const sync = async () => {
      try {
        const remoteViewModel = await loadRemoteDemoViewModel();
        if (!active) {
          return;
        }

        setViewModel(remoteViewModel);
        setSyncState("ready");
      } catch {
        if (!active) {
          return;
        }

        setSyncState("fallback");
      }
    };

    void sync();

    return () => {
      active = false;
    };
  }, []);

  const overallMetrics = viewModel.comparison.overallDeltas;
  const layerDeltas = viewModel.comparison.layerDeltas;
  const topCases = viewModel.caseDetails.slice(0, 2);
  const contractCards = useMemo(
    () => [
      {
        label: "Datasets",
        value: String(viewModel.datasets.length),
        detail: viewModel.datasets.map((dataset) => dataset.name).join(" / "),
      },
      {
        label: "Evaluators",
        value: String(viewModel.evaluators.length),
        detail: "共享 contract 与 mock data 对齐",
      },
      {
        label: "Experiment Runs",
        value: String(viewModel.experimentCount),
        detail: `${viewModel.baseline.target.version} -> ${viewModel.candidate.target.version}`,
      },
      {
        label: "Traces",
        value: String(viewModel.traceCount),
        detail: `${viewModel.meta.storage.driver} / ${viewModel.meta.storage.sqlite_path}`,
      },
    ],
    [viewModel],
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px",
        background: "linear-gradient(180deg, #eef3ff 0%, #f8faff 100%)",
        color: "#21304d",
        fontFamily: '"SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif',
      }}
    >
      <section
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          display: "grid",
          gap: "20px",
        }}
      >
        <header
          style={{
            background: "#ffffff",
            borderRadius: "24px",
            padding: "28px 32px",
            boxShadow: "0 18px 48px rgba(60, 91, 151, 0.12)",
          }}
        >
          <div style={{ fontSize: "14px", color: "#5f78b6", marginBottom: "8px" }}>
            Downey Evals Loop
          </div>
          <h1 style={{ margin: 0, fontSize: "42px", lineHeight: 1.1 }}>Infra / Integration Snapshot</h1>
          <p style={{ margin: "12px 0 0", fontSize: "18px", lineHeight: 1.6, color: "#61718f" }}>
            前端通过统一 `bootstrap` contract 读取 Dataset / Evaluator / Experiment / Trace，
            并在 API 不可用时回退到本地 seed mock，保证最小闭环可用。
          </p>
          <div style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <span
              style={{
                padding: "8px 12px",
                borderRadius: "999px",
                background: syncState === "ready" ? "#e7faf1" : "#eef3ff",
                color: syncState === "ready" ? "#16784a" : "#4d6296",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              {syncState === "ready" ? "API bootstrap 已接通" : "使用本地 seed fallback"}
            </span>
            <span
              style={{
                padding: "8px 12px",
                borderRadius: "999px",
                background: "#edf3ff",
                color: "#4d6296",
                fontSize: "13px",
              }}
            >
              {viewModel.meta.app_name}
            </span>
          </div>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
          }}
        >
          {overallMetrics.map((metric) => (
            <article
              key={metric.metricName}
              style={{
                background: "#ffffff",
                borderRadius: "20px",
                padding: "20px",
                boxShadow: "0 12px 32px rgba(60, 91, 151, 0.1)",
              }}
            >
              <div style={{ fontSize: "13px", color: "#7c8aa8", marginBottom: "8px" }}>{metric.metricName}</div>
              <div style={{ fontSize: "28px", fontWeight: 700 }}>{formatMetricValue(metric.candidateValue)}</div>
              <div
                style={{
                  marginTop: "8px",
                  color: metric.delta >= 0 ? "#138a5c" : "#c84040",
                  fontWeight: 600,
                }}
              >
                delta {formatDelta(metric.delta)}
              </div>
            </article>
          ))}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
          }}
        >
          {contractCards.map((card) => (
            <article
              key={card.label}
              style={{
                background: "#ffffff",
                borderRadius: "20px",
                padding: "20px",
                boxShadow: "0 12px 32px rgba(60, 91, 151, 0.1)",
              }}
            >
              <div style={{ fontSize: "13px", color: "#7c8aa8", marginBottom: "8px" }}>{card.label}</div>
              <div style={{ fontSize: "28px", fontWeight: 700 }}>{card.value}</div>
              <div style={{ marginTop: "8px", color: "#61718f", lineHeight: 1.6 }}>{card.detail}</div>
            </article>
          ))}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: "16px",
          }}
        >
          <article
            style={{
              background: "#ffffff",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 12px 32px rgba(60, 91, 151, 0.1)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Root Cause Summary</h2>
            <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.9 }}>
              {viewModel.comparison.rootCauseSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </article>

          <article
            style={{
              background: "#ffffff",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 12px 32px rgba(60, 91, 151, 0.1)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Layer Deltas</h2>
            <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.8 }}>
              {layerDeltas.slice(0, 6).map((metric) => (
                <li key={`${metric.layer}:${metric.metricName}`}>
                  {metric.layer} / {metric.metricName}: {formatDelta(metric.delta)}
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section
          style={{
            background: "#ffffff",
            borderRadius: "20px",
            padding: "24px",
            boxShadow: "0 12px 32px rgba(60, 91, 151, 0.1)",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Evidence Cases</h2>
          <div style={{ display: "grid", gap: "14px" }}>
            {topCases.map((caseItem) => (
              <div
                key={caseItem.caseId}
                style={{
                  border: "1px solid #d8e2ff",
                  borderRadius: "16px",
                  padding: "16px",
                  background: "#f9fbff",
                }}
              >
                <div style={{ fontSize: "13px", color: "#7381a0" }}>{caseItem.caseId}</div>
                <div style={{ fontSize: "18px", fontWeight: 600, marginTop: "6px" }}>{caseItem.title}</div>
                <div style={{ marginTop: "10px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  {caseItem.deltas.map((delta) => (
                    <span
                      key={delta.layer}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "999px",
                        background: "#edf3ff",
                        color: "#40527a",
                        fontSize: "13px",
                      }}
                    >
                      {delta.layer}: {formatDelta(delta.delta)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
};
