(() => {
  const themeKey = "shiptest-report-theme";
  const applyTheme = (theme) => {
    document.body.dataset.theme = theme || "shiptest";
    for (const select of document.querySelectorAll("[data-theme-select]")) {
      select.value = document.body.dataset.theme;
    }
  };
  applyTheme(localStorage.getItem(themeKey) || document.body.dataset.theme || "shiptest");
  for (const select of document.querySelectorAll("[data-theme-select]")) {
    select.addEventListener("change", () => {
      localStorage.setItem(themeKey, select.value);
      applyTheme(select.value);
    });
  }

  for (const tabRoot of document.querySelectorAll("[data-tabs]")) {
    const buttons = Array.from(tabRoot.querySelectorAll("[data-tab-button]"));
    const panels = Array.from(tabRoot.querySelectorAll("[data-tab-panel]"));
    const selectTab = (tabId) => {
      for (const button of buttons) {
        const active = button.getAttribute("data-tab-button") === tabId;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      }
      for (const panel of panels) {
        const active = panel.getAttribute("data-tab-panel") === tabId;
        panel.hidden = !active;
      }
    };
    for (const button of buttons) {
      button.addEventListener("click", () => selectTab(button.getAttribute("data-tab-button")));
    }
    selectTab(
      buttons
        .find((button) => button.classList.contains("active"))
        ?.getAttribute("data-tab-button") ??
        buttons[0]?.getAttribute("data-tab-button") ??
        "overview",
    );
  }

  let pinnedModelId = null;
  const clearModelHighlights = () => {
    for (const row of document.querySelectorAll("[data-model-row].model-row-highlight")) {
      row.classList.remove("model-row-highlight");
    }
    for (const bar of document.querySelectorAll("[data-model-bar].model-bar-pinned")) {
      bar.classList.remove("model-bar-pinned");
    }
  };
  const highlightModel = (modelId) => {
    clearModelHighlights();
    if (!modelId) return;
    for (const row of document.querySelectorAll("[data-model-row]")) {
      if (row.getAttribute("data-model-row") === modelId) {
        row.classList.add("model-row-highlight");
      }
    }
    for (const bar of document.querySelectorAll("[data-model-bar]")) {
      if (bar.getAttribute("data-model-bar") === modelId) {
        bar.classList.add("model-bar-pinned");
      }
    }
  };
  const bindModelBars = (root = document) => {
    for (const bar of root.querySelectorAll("[data-model-bar]")) {
      if (bar.dataset.boundModelBar === "true") continue;
      bar.dataset.boundModelBar = "true";
      const modelId = bar.getAttribute("data-model-bar");
      bar.addEventListener("mouseenter", () => {
        if (pinnedModelId === null) highlightModel(modelId);
      });
      bar.addEventListener("focus", () => {
        if (pinnedModelId === null) highlightModel(modelId);
      });
      bar.addEventListener("mouseleave", () => {
        if (pinnedModelId === null) clearModelHighlights();
      });
      bar.addEventListener("blur", () => {
        if (pinnedModelId === null) clearModelHighlights();
      });
      bar.addEventListener("click", (event) => {
        event.preventDefault();
        if (pinnedModelId === modelId) {
          pinnedModelId = null;
          clearModelHighlights();
          return;
        }
        pinnedModelId = modelId;
        highlightModel(modelId);
      });
    }
  };

  const scale = (value, min, max, outMin, outMax) => {
    if (max <= min) return outMax;
    return Math.max(
      outMin,
      Math.min(outMax, outMin + ((value - min) / (max - min)) * (outMax - outMin)),
    );
  };
  const shortValue = (value) =>
    String(value).length > 8 ? `${String(value).slice(0, 7)}…` : String(value);
  const escapeAttribute = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const slugify = (value) =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const renderChartSeries = (chart, series) => {
    const title = chart.querySelector("[data-chart-title]");
    const subtitle = chart.querySelector("[data-chart-subtitle]");
    const legend = chart.querySelector(".legend-square");
    const barsRoot = chart.querySelector("[data-chart-bars]");
    if (!barsRoot) return;
    if (title) title.textContent = series.title;
    if (subtitle) subtitle.textContent = series.subtitle;
    if (legend) legend.style.background = series.color;
    const values = series.bars
      .map((bar) => bar.value)
      .filter((value) => typeof value === "number" && Number.isFinite(value));
    const max = Math.max(...values, 1);
    const min = values.length > 0 ? Math.min(...values) : 0;
    barsRoot.innerHTML =
      series.bars.length > 0
        ? series.bars
            .map((bar) => {
              const scaleMin = bar.scaleMode === "relative" ? min : 0;
              const height =
                bar.pending || typeof bar.value !== "number"
                  ? 35
                  : bar.higherIsBetter
                    ? scale(bar.value, scaleMin, max, 18, 100)
                    : scale(max - bar.value + scaleMin, scaleMin, max, 18, 100);
              const modelKey = slugify(bar.label);
              return (
                '<a class="bar-wrap" href="' +
                escapeAttribute(bar.href ?? "#artifacts") +
                '" data-model-bar="' +
                escapeAttribute(modelKey) +
                '" data-detail="' +
                escapeAttribute(bar.detail) +
                '" style="--bar-height:' +
                height +
                '%"><span class="bar" style="background:' +
                escapeAttribute(bar.color) +
                '"><span class="bar-chip">' +
                escapeAttribute(shortValue(bar.display)) +
                '</span></span><span class="bar-label">' +
                escapeAttribute(bar.label) +
                "</span></a>"
              );
            })
            .join("")
        : '<div class="muted">No attempts yet.</div>';
  };

  const chartGroups = new Map();
  for (const chart of document.querySelectorAll("[data-metric-chart]")) {
    const group = chart.getAttribute("data-chart-group") || chart.id || "default";
    const existing = chartGroups.get(group) ?? [];
    existing.push(chart);
    chartGroups.set(group, existing);
  }
  const setChartMetric = (group, metricId) => {
    const charts = chartGroups.get(group) ?? [];
    for (const chart of charts) {
      const seriesNode = chart.querySelector("[data-chart-series]");
      const select = chart.querySelector("[data-chart-select]");
      if (!seriesNode) continue;
      const series = JSON.parse(seriesNode.textContent || "[]");
      const selected = series.find((item) => item.id === metricId) ?? series[0];
      if (!selected) continue;
      if (select) select.value = selected.id;
      renderChartSeries(chart, selected);
      bindModelBars(chart);
      if (pinnedModelId !== null) highlightModel(pinnedModelId);
    }
  };
  for (const [group, charts] of chartGroups.entries()) {
    for (const chart of charts) {
      const select = chart.querySelector("[data-chart-select]");
      if (!select) continue;
      select.addEventListener("change", () => setChartMetric(group, select.value));
    }
    const initialSelect = charts
      .find((chart) => chart.querySelector("[data-chart-select]"))
      ?.querySelector("[data-chart-select]");
    if (initialSelect) setChartMetric(group, initialSelect.value);
  }

  for (const qualityRoot of document.querySelectorAll("[data-quality-report]")) {
    const attempts = Array.from(qualityRoot.querySelectorAll("[data-quality-attempt]"));
    const search = qualityRoot.querySelector("[data-quality-search]");
    const status = qualityRoot.querySelector("[data-quality-status]");
    const model = qualityRoot.querySelector("[data-quality-model]");
    const failedTools = qualityRoot.querySelector("[data-quality-failed-tools]");
    const minScore = qualityRoot.querySelector("[data-quality-min-score]");
    const maxScore = qualityRoot.querySelector("[data-quality-max-score]");
    const clear = qualityRoot.querySelector("[data-quality-clear]");
    const exportButton = qualityRoot.querySelector("[data-quality-export]");

    for (const attempt of attempts) {
      attempt.addEventListener("toggle", () => {
        if (!attempt.open) return;
        for (const other of attempts) {
          if (other !== attempt) other.open = false;
        }
      });
      const buttons = Array.from(attempt.querySelectorAll("[data-quality-tab-button]"));
      const panels = Array.from(attempt.querySelectorAll("[data-quality-tab-panel]"));
      const selectTab = (tabId) => {
        for (const button of buttons) {
          const active = button.getAttribute("data-quality-tab-button") === tabId;
          button.classList.toggle("active", active);
          button.setAttribute("aria-selected", active ? "true" : "false");
        }
        for (const panel of panels) {
          panel.hidden = panel.getAttribute("data-quality-tab-panel") !== tabId;
        }
      };
      for (const button of buttons) {
        button.addEventListener("click", () =>
          selectTab(button.getAttribute("data-quality-tab-button")),
        );
      }
    }

    const normalizedStatus = (value) =>
      value === "passed" || value === "needs_review" ? value : "failed";
    const applyQualityFilters = () => {
      const query = (search?.value ?? "").trim().toLowerCase();
      const wantedStatus = status?.value ?? "all";
      const wantedModel = model?.value ?? "all";
      const wantedFailedTools = failedTools?.value ?? "all";
      const min = minScore?.value === "" ? undefined : Number(minScore?.value);
      const max = maxScore?.value === "" ? undefined : Number(maxScore?.value);
      for (const attempt of attempts) {
        const score = attempt.dataset.score === "" ? undefined : Number(attempt.dataset.score);
        const failed = Number(attempt.dataset.failedTools ?? 0);
        const visible =
          (query === "" || (attempt.dataset.search ?? "").includes(query)) &&
          (wantedStatus === "all" ||
            normalizedStatus(attempt.dataset.status ?? "") === wantedStatus) &&
          (wantedModel === "all" || attempt.dataset.model === wantedModel) &&
          (wantedFailedTools === "all" ||
            (wantedFailedTools === "none" ? failed === 0 : failed > 0)) &&
          (min === undefined || (score !== undefined && score >= min)) &&
          (max === undefined || (score !== undefined && score <= max));
        attempt.hidden = !visible;
        if (!visible) attempt.open = false;
      }
    };
    for (const input of [search, status, model, failedTools, minScore, maxScore]) {
      input?.addEventListener("input", applyQualityFilters);
      input?.addEventListener("change", applyQualityFilters);
    }
    clear?.addEventListener("click", () => {
      if (search) search.value = "";
      if (status) status.value = "all";
      if (model) model.value = "all";
      if (failedTools) failedTools.value = "all";
      if (minScore) minScore.value = "";
      if (maxScore) maxScore.value = "";
      applyQualityFilters();
    });
    exportButton?.addEventListener("click", () => {
      const rows = attempts
        .filter((attempt) => !attempt.hidden)
        .map((attempt) => ({
          id: attempt.id,
          model: attempt.dataset.model,
          status: attempt.dataset.status,
          score: attempt.dataset.score,
          failedTools: attempt.dataset.failedTools,
        }));
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "shiptest-quality-details.json";
      link.click();
      URL.revokeObjectURL(url);
    });
    applyQualityFilters();
  }

  for (const tableRoot of document.querySelectorAll("[data-paginated-table]")) {
    const tbody = tableRoot.querySelector("tbody");
    if (!tbody) continue;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const pageSize = Math.max(1, Number(tableRoot.getAttribute("data-page-size") || 5));
    if (rows.length <= pageSize) continue;
    let page = 0;
    const pageCount = Math.ceil(rows.length / pageSize);
    const pager = document.createElement("div");
    pager.className = "table-pager";
    pager.innerHTML =
      '<span class="table-pager-info"></span><div class="table-pager-controls"><button type="button" data-page-prev>Previous</button><button type="button" data-page-next>Next</button></div>';
    tableRoot.appendChild(pager);
    const info = pager.querySelector(".table-pager-info");
    const prev = pager.querySelector("[data-page-prev]");
    const next = pager.querySelector("[data-page-next]");
    const renderPage = () => {
      const start = page * pageSize;
      const end = Math.min(start + pageSize, rows.length);
      for (const [index, row] of rows.entries()) {
        row.hidden = index < start || index >= end;
      }
      if (info) info.textContent = `Showing ${start + 1}–${end} of ${rows.length} attempts`;
      if (prev) prev.disabled = page === 0;
      if (next) next.disabled = page >= pageCount - 1;
    };
    prev?.addEventListener("click", () => {
      page = Math.max(0, page - 1);
      renderPage();
    });
    next?.addEventListener("click", () => {
      page = Math.min(pageCount - 1, page + 1);
      renderPage();
    });
    renderPage();
  }

  const clearRadarHighlights = () => {
    for (const item of document.querySelectorAll("[data-model-radar], [data-model-radar-legend]")) {
      item.classList.remove("model-radar-highlight", "model-radar-dim");
    }
  };
  const highlightRadarModel = (modelId) => {
    clearRadarHighlights();
    if (!modelId) return;
    for (const item of document.querySelectorAll("[data-model-radar], [data-model-radar-legend]")) {
      const itemModelId =
        item.getAttribute("data-model-radar") ?? item.getAttribute("data-model-radar-legend");
      if (itemModelId === modelId) {
        item.classList.add("model-radar-highlight");
      } else {
        item.classList.add("model-radar-dim");
      }
    }
  };
  for (const item of document.querySelectorAll("[data-model-radar], [data-model-radar-legend]")) {
    const modelId =
      item.getAttribute("data-model-radar") ?? item.getAttribute("data-model-radar-legend");
    item.addEventListener("mouseenter", () => highlightRadarModel(modelId));
    item.addEventListener("focus", () => highlightRadarModel(modelId));
    item.addEventListener("mouseleave", clearRadarHighlights);
    item.addEventListener("blur", clearRadarHighlights);
  }

  bindModelBars();
})();
