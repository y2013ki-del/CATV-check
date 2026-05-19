const state = {
  sectors: [],
  selected: null,
  page: "select",
  signalStep: 0,
  signalTotal: 13,
  action: "start",
  history: null,
  historyFilter: "all",
  historyMonth: null,
  historyDetail: null,
  historyEditingChecklist: false,
  signalLegacySteps: [],
};

const GROUP_LABELS = {
  K1: "K1 건물",
  K2: "K2 건물",
  "사외": "사외",
};

const CHECK_RESULT_OPTIONS = ["양호", "불량", "해당없음", "기타"];

const $ = (selector) => document.querySelector(selector);
const API_BASE = window.CATV_API_BASE || "";
const apiUrl = (path) => `${API_BASE}${path}`;
const USE_JSONP_API = /^https?:\/\//.test(API_BASE);

function jsonp(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const callback = `catvJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const params = new URLSearchParams({
      action,
      callback,
      payload: JSON.stringify(payload),
      _: String(Date.now()),
    });
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("스프레드시트 응답 시간이 초과되었습니다."));
    }, 45000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callback];
      script.remove();
    }

    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("스프레드시트 API를 불러오지 못했습니다."));
    };
    script.src = `${API_BASE}?${params.toString()}`;
    document.head.appendChild(script);
  });
}

function actionForPath(path) {
  if (path === "/api/bootstrap") return "bootstrap";
  if (path === "/api/history") return "history";
  if (path.startsWith("/api/history/detail")) return "historyDetail";
  if (path === "/api/start") return "start";
  if (path === "/api/fiber/save") return "fiberSave";
  if (path === "/api/signal") return "signal";
  if (path === "/api/signal/save") return "signalSave";
  if (path === "/api/checklist") return "checklist";
  if (path === "/api/checklist/save") return "checklistSave";
  if (path === "/api/note") return "note";
  if (path === "/api/note/save") return "noteSave";
  throw new Error(`지원하지 않는 요청입니다: ${path}`);
}

async function getJson(path) {
  if (USE_JSONP_API) {
    const payload = {};
    if (path.startsWith("/api/history/detail")) {
      const query = path.split("?")[1] || "";
      payload.building = new URLSearchParams(query).get("building") || "";
    }
    return jsonp(actionForPath(path), payload);
  }
  const response = await fetch(apiUrl(path));
  return response.json();
}

async function postJson(path, payload) {
  if (USE_JSONP_API) {
    const data = await jsonp(actionForPath(path), payload);
    if (!data.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
    return data;
  }
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function todayCompact(value) {
  return value ? value.replaceAll("-", ".") : "----";
}

function setAction(label, action, enabled = true) {
  state.action = action;
  const button = $("#primaryAction");
  button.textContent = label;
  button.disabled = !enabled;
}

function setView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.viewTab === name));
  $(`#${name}View`).classList.add("active");
  const shouldShowAction = name === "check" && state.page !== "done";
  $(".bottomBar").style.display = shouldShowAction ? "block" : "none";
  if (name === "history") loadHistory();
}

function setPage(name) {
  state.page = name;
  document.querySelectorAll("#checkView .page").forEach((page) => page.classList.remove("active"));
  $(`#${name}Page`).classList.add("active");
  if (name === "select") setAction("점검 시작 →", "start", Boolean(state.selected));
  if (name === "fiber") setAction("다음 →", "fiber", true);
  if (name === "signal") setAction("다음 →", "signal", true);
  if (name === "checklist") setAction("다음 →", "checklist", true);
  if (name === "note") setAction("완료 →", "note", true);
  if (name === "done") $(".bottomBar").style.display = "none";
}

function toast(selector, message, tone = "good") {
  const node = $(selector);
  node.className = `toast show ${tone}`;
  node.textContent = message;
}

function clearToast(selector) {
  const node = $(selector);
  node.className = "toast";
  node.textContent = "";
}

function renderGroups() {
  const container = $("#sectorGroups");
  const grouped = state.sectors.reduce((map, sector) => {
    const key = sector.region || "기타";
    if (!map[key]) map[key] = [];
    map[key].push(sector);
    return map;
  }, {});

  container.innerHTML = Object.entries(grouped)
    .map(([region, sectors]) => {
      const buttons = sectors
        .map(
          (sector) => `
            <button class="sectorButton" type="button" data-building="${sector.building}">
              ${sector.building}
            </button>
          `,
        )
        .join("");
      return `
        <section class="group">
          <h2 class="groupTitle">${GROUP_LABELS[region] || region}</h2>
          <div class="groupLine"></div>
          <div class="sectorGrid">${buttons}</div>
        </section>
      `;
    })
    .join("");

  container.querySelectorAll(".sectorButton").forEach((button) => {
    button.addEventListener("click", () => {
      const sector = state.sectors.find((item) => item.building === button.dataset.building);
      selectSector(sector);
    });
  });
}

function selectSector(sector) {
  state.selected = sector;
  document.querySelectorAll(".sectorButton").forEach((button) => {
    button.classList.toggle("active", button.dataset.building === sector.building);
  });
  setAction("점검 시작 →", "start", true);
}

function fieldTemplate(item, value = "", previous = "") {
  const detail = [item.channel, item.measure, item.kind, item.label].filter(Boolean).join(" · ");
  const previousLine = previous ? `<small class="previousValue">이전 값: ${previous}</small>` : "";
  return `
    <div class="field">
      <label for="field-${item.letter}">${item.letter}열</label>
      <p>${detail || "측정값"}</p>
      ${previousLine}
      <input id="field-${item.letter}" data-col="${item.letter}" inputmode="decimal" value="${value ?? ""}" placeholder="숫자 입력" />
    </div>
  `;
}

function collectValues(containerSelector) {
  const values = {};
  document.querySelectorAll(`${containerSelector} input, ${containerSelector} textarea`).forEach((input) => {
    values[input.dataset.col] = input.value.trim();
  });
  return values;
}

function renderFiberFields() {
  $("#fiberGrid").innerHTML = [
    { letter: "H", label: "CATV 하향 (1550nm) 0(dBm)" },
    { letter: "I", label: "CATV 상향 (1310nm) +3(dBm)" },
    { letter: "J", label: "SATV 하향 (1550nm) 0(dBm)" },
  ]
    .map((item) => fieldTemplate(item))
    .join("");
}

async function startInspection() {
  if (!state.selected) return;
  try {
    const result = await postJson("/api/start", { building: state.selected.building });
    $("#fiberRegion").textContent = `${result.region} · ${result.measureSheet}`;
    $("#fiberBuilding").textContent = result.building;
    renderFiberFields();
    clearToast("#fiberResult");
    toast("#fiberResult", `${result.planRow}행 ${result.planColumn}열에 ${result.written} 입력 완료`);
    setPage("fiber");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    alert(error.message);
  }
}

async function saveFiber() {
  try {
    const result = await postJson("/api/fiber/save", {
      building: state.selected.building,
      values: collectValues("#fiberGrid"),
    });
    state.signalStep = 0;
    $("#signalRegion").textContent = `${state.selected.region} · ${result.row}행`;
    $("#signalBuilding").textContent = state.selected.building;
    await renderSignal();
    setPage("signal");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    toast("#fiberResult", error.message, "warn");
  }
}

async function renderSignal() {
  const result = await postJson("/api/signal", {
    building: state.selected.building,
  });
  state.signalTotal = 1;
  state.signalLegacySteps = [];
  let groups = result.groups;
  if (!groups && result.headers) {
    const legacy = await loadLegacySignalSteps(result);
    state.signalLegacySteps = legacy.steps;
    groups = legacy.groups;
  }
  $("#signalMeta").textContent = `${result.sheet} · ${result.monthRow}행`;
  $("#signalTitle").textContent = "신호값 입력";
  $("#signalProgress").style.width = "100%";
  $("#signalGrid").innerHTML = signalGroupsTemplate(groups);
  toast("#signalResult", "채널별 RF / EVM / MER 값을 입력하세요.");
}

async function saveSignal() {
  try {
    const values = collectValues("#signalGrid");
    if (state.signalLegacySteps.length) {
      for (const step of state.signalLegacySteps) {
        const stepValues = {};
        step.headers.forEach((header) => {
          if (header.col <= 27) stepValues[header.letter] = values[header.letter] || "";
        });
        if (Object.keys(stepValues).length) {
          await postJson("/api/signal/save", {
            building: state.selected.building,
            step: step.step,
            values: stepValues,
          });
        }
      }
    } else {
      await postJson("/api/signal/save", {
        building: state.selected.building,
        values,
      });
    }
    await renderChecklist();
    setPage("checklist");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    toast("#signalResult", error.message, "warn");
  }
}

async function loadLegacySignalSteps(firstResult) {
  const steps = [
    {
      step: firstResult.step || 0,
      headers: firstResult.headers || [],
      values: firstResult.values || {},
    },
  ];
  const total = firstResult.totalSteps || 1;
  for (let step = 1; step < total; step += 1) {
    const result = await postJson("/api/signal", {
      building: state.selected.building,
      step,
    });
    steps.push({
      step,
      headers: result.headers || [],
      values: result.values || {},
    });
  }
  return { steps, groups: legacySignalGroups(steps) };
}

function metricTitleFromHeader(header) {
  if (header.kind === "신호값" || (header.measure || "").includes("RF Power")) return "RF";
  if (header.kind === "EVM") return "EVM";
  if (header.kind === "MER") return "MER";
  return header.kind || header.measure || "값";
}

function legacySignalGroups(steps) {
  const items = steps
    .flatMap((step) =>
      step.headers.map((header) => ({
        ...header,
        value: step.values?.[header.letter] ?? "",
      })),
    )
    .filter((item) => item.col <= 27)
    .sort((left, right) => left.col - right.col);

  const groups = [];
  let current = null;
  items.forEach((item) => {
    if (item.channel) {
      current = { channel: item.channel, metrics: [] };
      groups.push(current);
    }
    if (!current) {
      current = { channel: item.channel || item.letter, metrics: [] };
      groups.push(current);
    }
    current.metrics.push({
      letter: item.letter,
      title: metricTitleFromHeader(item),
      measure: item.measure,
      kind: item.kind,
      value: item.value,
    });
  });
  return groups.filter((group) => group.metrics.length);
}

function signalGroupsTemplate(groups = []) {
  if (!groups.length) return '<p class="measureNotice">표시할 신호값 항목이 없습니다.</p>';
  return `
    <div class="signalInputList">
      ${groups
        .map(
          (group) => `
            <article class="signalInputRow">
              <strong class="signalChannel">${group.channel}</strong>
              <div class="signalMetrics">
                ${group.metrics
                  .map(
                    (metric) => `
                      <label class="signalMetric">
                        <span>${metric.title}<small>${metric.letter}열</small></span>
                        <input
                          data-col="${metric.letter}"
                          inputmode="decimal"
                          value="${metric.value ?? ""}"
                          placeholder="-"
                          aria-label="${group.channel} ${metric.title}"
                        />
                      </label>
                    `,
                  )
                  .join("")}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function checklistResultMode(result) {
  if (!result) return "";
  return CHECK_RESULT_OPTIONS.includes(result) ? result : "기타";
}

function checklistEditorTemplate(items, target = "flow") {
  return (items || [])
    .map((item) => {
      const mode = checklistResultMode(item.result);
      const customValue = mode === "기타" ? item.result : "";
      const options = ['<option value="">선택</option>', ...CHECK_RESULT_OPTIONS.map((option) => `<option value="${option}" ${mode === option ? "selected" : ""}>${option}</option>`)].join("");
      return `
        <article class="checkEditItem" data-row="${item.row}" data-target="${target}">
          <div class="checkEditMeta">
            <strong>${item.item || item.equipment || "점검 항목"}</strong>
            <span>${[item.standard, item.method].filter(Boolean).join(" · ") || "기준 없음"}</span>
          </div>
          <select data-row="${item.row}" data-role="result" aria-label="점검 결과">
            ${options}
          </select>
          <input
            class="customResult ${mode === "기타" ? "show" : ""}"
            data-row="${item.row}"
            data-role="custom"
            value="${customValue || ""}"
            placeholder="기타 결과 입력"
          />
        </article>
      `;
    })
    .join("");
}

function bindChecklistEditors(rootSelector) {
  document.querySelectorAll(`${rootSelector} select[data-role="result"]`).forEach((select) => {
    const custom = select.closest(".checkEditItem")?.querySelector('[data-role="custom"]');
    const sync = () => {
      if (!custom) return;
      custom.classList.toggle("show", select.value === "기타");
      if (select.value !== "기타") custom.value = "";
    };
    select.addEventListener("change", sync);
    sync();
  });
}

function collectChecklistValues(rootSelector) {
  return Array.from(document.querySelectorAll(`${rootSelector} .checkEditItem`)).map((item) => {
    const row = Number(item.dataset.row);
    const mode = item.querySelector('[data-role="result"]')?.value || "";
    const custom = item.querySelector('[data-role="custom"]')?.value.trim() || "";
    return { row, result: mode === "기타" ? custom : mode };
  });
}

async function renderChecklist() {
  const result = await postJson("/api/checklist", { building: state.selected.building });
  $("#checklistRegion").textContent = `${state.selected.region} · ${result.sheet || "점검 시트"}`;
  $("#checklistBuilding").textContent = state.selected.building;
  $("#checklistMeta").textContent = result.sheet ? `${result.sheet} · H열 결과` : "건물별 점검 시트를 찾지 못했습니다";
  $("#checklistGrid").innerHTML = checklistEditorTemplate(result.items, "flow") || '<p class="measureNotice">표시할 점검 항목이 없습니다.</p>';
  bindChecklistEditors("#checklistGrid");
  clearToast("#checklistResult");
}

async function saveChecklist() {
  try {
    await postJson("/api/checklist/save", {
      building: state.selected.building,
      items: collectChecklistValues("#checklistGrid"),
    });
    await renderNote();
    setPage("note");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    toast("#checklistResult", error.message, "warn");
  }
}

async function renderNote() {
  const result = await postJson("/api/note", { building: state.selected.building });
  const inspector = $("#inspectorName").value.trim();
  $("#noteRegion").textContent = `${state.selected.region} · ${result.sheet}`;
  $("#noteBuilding").textContent = state.selected.building;
  $("#noteMeta").textContent = `${result.monthLabel} · ${result.monthRow}행`;
  $("#noteGrid").innerHTML = `
    <div class="field">
      <label for="note-location">위치</label>
      <p>측정 위치 또는 방송단자함 위치를 입력합니다.</p>
      ${result.previous?.AB ? `<small class="previousValue">이전 값: ${result.previous.AB}</small>` : ""}
      <input id="note-location" data-col="AB" value="${result.values?.AB || result.previous?.AB || ""}" placeholder="위치 입력" />
    </div>
    <div class="field">
      <label for="note-remark">비고</label>
      <p>특이사항, 보완 필요사항 등을 입력합니다.</p>
      <textarea id="note-remark" data-col="AC" rows="4" placeholder="비고 입력">${result.values?.AC || ""}</textarea>
    </div>
    <div class="field">
      <label for="note-inspector">점검자</label>
      <p>점검자 이름을 저장합니다.</p>
      <input id="note-inspector" data-col="AD" value="${result.values?.AD || inspector || ""}" placeholder="점검자 입력" />
    </div>
  `;
  clearToast("#noteResult");
}

async function saveNote() {
  try {
    await postJson("/api/note/save", {
      building: state.selected.building,
      values: collectValues("#noteGrid"),
      inspector: $("#inspectorName").value.trim(),
    });
    setPage("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    toast("#noteResult", error.message, "warn");
  }
}

async function handlePrimaryAction() {
  if (state.action === "start") await startInspection();
  else if (state.action === "fiber") await saveFiber();
  else if (state.action === "signal") await saveSignal();
  else if (state.action === "checklist") await saveChecklist();
  else if (state.action === "note") await saveNote();
}

function restart() {
  state.signalStep = 0;
  state.historyEditingChecklist = false;
  setPage("select");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadHistory() {
  if (!state.history) {
    const data = await getJson("/api/history");
    if (!data.ok) throw new Error(data.error || "히스토리를 불러오지 못했습니다.");
    state.history = data;
    state.historyMonth = String(data.summary.currentMonth);
    renderHistoryMonthOptions();
  }
  renderHistory();
}

function renderHistoryMonthOptions() {
  const select = $("#historyMonthFilter");
  select.innerHTML = state.history.months
    .map((month) => `<option value="${month.month}">${month.label}</option>`)
    .join("");
  select.value = state.historyMonth;
}

function filteredHistoryRows() {
  if (!state.history) return [];
  if (state.historyFilter === "all") return state.history.rows;
  return state.history.rows.filter((row) => row.region === state.historyFilter);
}

function renderHistory() {
  const rows = filteredHistoryRows();
  const selectedMonth = state.historyMonth || String(state.history.summary.currentMonth);
  const checked = rows.filter((row) => row.checks[selectedMonth]).length;
  const monthLabel = state.history.months.find((month) => String(month.month) === selectedMonth)?.label || `${selectedMonth}월`;
  $("#historyTotal").textContent = rows.length;
  $("#historyChecked").textContent = checked;
  $("#historyUnchecked").textContent = rows.length - checked;
  $("#historyCheckedLabel").textContent = `${monthLabel} 이행`;

  const monthCounts = {};
  for (const row of rows) {
    for (let month = 1; month <= 12; month += 1) {
      const key = String(month);
      if (!monthCounts[key]) monthCounts[key] = 0;
      if (row.checks[key]) monthCounts[key] += 1;
    }
  }

  $("#monthSummary").innerHTML = state.history.months
    .map(
      (month) => `
        <button class="monthChip ${String(month.month) === selectedMonth ? "active" : ""}" type="button" data-month="${month.month}">
          <span>${month.label}</span>
          <strong>${monthCounts[String(month.month)] || 0}</strong>
        </button>
      `,
    )
    .join("");

  $("#historyList").innerHTML = rows
    .map((row) => {
      const months = state.history.months
        .map((month) => {
          const value = row.checks[String(month.month)] || "";
          return `
            <button class="historyMonth ${value ? "checked" : ""} ${String(month.month) === selectedMonth ? "active" : ""}" type="button" data-month="${month.month}" data-building="${row.building}">
              <em>${month.month}</em>
              <span>${value || "-"}</span>
            </button>
          `;
        })
        .join("");
      return `
        <article class="historyCard" data-building="${row.building}">
          <div class="historyCardTop">
            <strong>${row.building}</strong>
            <span class="regionBadge region-${row.region}">${row.region}</span>
          </div>
          <div class="historyMonths">${months}</div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-month]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      setHistoryMonth(node.dataset.month);
      if (node.dataset.building) loadHistoryDetail(node.dataset.building);
    });
  });

  $("#historyList").querySelectorAll(".historyCard").forEach((card) => {
    card.addEventListener("click", () => loadHistoryDetail(card.dataset.building));
  });
  renderHistoryDetail();
}

function setHistoryMonth(month) {
  state.historyMonth = String(month);
  const select = $("#historyMonthFilter");
  if (select) select.value = state.historyMonth;
  renderHistory();
}

async function loadHistoryDetail(building) {
  const data = await getJson(`/api/history/detail?building=${encodeURIComponent(building)}`);
  if (!data.ok) throw new Error(data.error || "상세 정보를 불러오지 못했습니다.");
  state.historyDetail = data;
  state.historyEditingChecklist = false;
  renderHistoryDetail();
  $("#historyDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

function emptyValue(value) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function renderHistoryDetail() {
  const box = $("#historyDetail");
  if (!box) return;
  const detail = state.historyDetail;
  if (!detail) {
    box.className = "historyDetail";
    box.innerHTML = "";
    return;
  }

  const fiberMetrics = detail.fiber.values
    .map(
      (item) => `
        <div class="detailMetric">
          <span>${item.letter} · ${item.label}</span>
          <strong>${emptyValue(item.value)}</strong>
        </div>
      `,
    )
    .join("");

  const measurement = detail.measurement;
  const measurementNotice =
    measurement && !measurement.matchesBuilding
      ? `<p class="measureNotice">${measurement.sheet} 시트의 현재 기준 건물은 '${emptyValue(measurement.sheetBuilding)}'입니다. 선택 건물과 다르면 점검 입력 후 최신 값으로 갱신됩니다.</p>`
      : "";
  const measurementMonths = measurement
    ? measurement.months
        .filter((month) => month.filledCount > 0 || month.location || month.inspector || month.note)
        .map((month, index) => {
          const selectedMonthLabel = state.history?.months.find((entry) => String(entry.month) === state.historyMonth)?.label;
          const shouldOpen = selectedMonthLabel ? month.month === selectedMonthLabel : index === 0;
          const rows = (month.groups || [])
            .map(
              (group) => `
                <tr>
                  <td class="channelCell">${group.channel}<small>RF Power / Carrier 값을 같은 채널 단위로 표시</small></td>
                  <td>${emptyValue(group.rfPower)}</td>
                  <td>${emptyValue(group.evm)}</td>
                  <td>${emptyValue(group.mer)}</td>
                </tr>
              `,
            )
            .join("");
          const meta = [month.location && `위치 ${month.location}`, month.note && `특이사항 ${month.note}`, month.inspector && `점검자 ${month.inspector}`]
            .filter(Boolean);
          const metaHtml = [
            month.location && `<div><span>위치 :</span> ${month.location}</div>`,
            month.note && `<div><span>특이사항 :</span> ${month.note}</div>`,
            month.inspector && `<div><span>점검자 :</span> ${month.inspector}</div>`,
          ]
            .filter(Boolean)
            .join("");
          return `
            <details class="measureMonth" ${shouldOpen ? "open" : ""}>
              <summary><span>${month.month}</span><span>${month.filledCount}개 값</span></summary>
              ${meta.length ? `<div class="measureMeta">${metaHtml}</div>` : ""}
              <div class="measureValues">
                <table class="measureTable">
                  <thead>
                    <tr>
                      <th>채널</th>
                      <th>RF Power<br><small>신호값</small></th>
                      <th>Carrier<br><small>EVM</small></th>
                      <th>Carrier<br><small>MER</small></th>
                    </tr>
                  </thead>
                  <tbody>${rows || '<tr><td colspan="4">표시할 측정값이 없습니다.</td></tr>'}</tbody>
                </table>
              </div>
            </details>
          `;
        })
        .join("")
    : "";

  const checklistRows = detail.checklist?.items || [];
  const checklistItems = checklistRows
    .map(
      (item) => `
        <div class="checkResult">
          <div>
            <strong>${item.item || item.equipment || "점검 항목"}</strong>
            <span>${[item.standard, item.method].filter(Boolean).join(" · ")}</span>
          </div>
          <strong>${emptyValue(item.result)}</strong>
        </div>
      `,
    )
    .join("");
  const checklistEditor = checklistEditorTemplate(checklistRows, "history");

  box.className = "historyDetail show";
  box.innerHTML = `
    <section class="detailPanel dark">
      <div class="detailTop">
        <div>
          <h2>${detail.building}</h2>
          <p><span class="regionBadge region-${detail.region}">${detail.region}</span> 광선로 / 측정값 상세</p>
        </div>
        <button class="detailClose" type="button" aria-label="상세 닫기">×</button>
      </div>
      <div class="detailGrid">
        <div class="detailMetric"><span>광선로 행</span><strong>${detail.fiber.row}</strong></div>
        <div class="detailMetric"><span>마지막 점검일</span><strong>${emptyValue(detail.fiber.lastDate)}</strong></div>
        <div class="detailMetric"><span>측정값 시트</span><strong>${measurement ? measurement.sheet : "-"}</strong></div>
      </div>
    </section>

    <section class="detailPanel">
      <div class="detailTop"><h2>측정값</h2></div>
      ${measurementNotice}
      <div class="measureMonthList">${measurementMonths || '<p class="measureNotice">표시할 측정값이 없습니다.</p>'}</div>
    </section>

    <div class="detailLowerGrid">
      <section class="detailPanel">
        <div class="detailTop"><h2>광선로</h2></div>
        <div class="detailGrid">${fiberMetrics}</div>
      </section>

      <section class="detailPanel">
        <div class="detailTop">
          <h2>건물 점검 결과</h2>
          <button id="editChecklistButton" class="miniButton" type="button">${state.historyEditingChecklist ? "보기" : "수정"}</button>
        </div>
        <div class="checkResultList ${state.historyEditingChecklist ? "editing" : ""}">
          ${
            state.historyEditingChecklist
              ? `
                <div id="historyChecklistEditor" class="checkEditList">${checklistEditor || '<p class="measureNotice">표시할 점검 항목이 없습니다.</p>'}</div>
                <div class="historyEditActions">
                  <button id="saveHistoryChecklist" class="fileButton" type="button">수정 저장</button>
                  <button id="cancelHistoryChecklist" class="ghostButton" type="button">취소</button>
                </div>
                <div id="historyChecklistResult" class="toast"></div>
              `
              : checklistItems || '<p class="measureNotice">표시할 점검 항목이 없습니다.</p>'
          }
        </div>
      </section>
    </div>
  `;
  box.querySelector(".detailClose").addEventListener("click", () => {
    state.historyDetail = null;
    state.historyEditingChecklist = false;
    renderHistoryDetail();
  });
  const editButton = box.querySelector("#editChecklistButton");
  if (editButton) {
    editButton.addEventListener("click", () => {
      state.historyEditingChecklist = !state.historyEditingChecklist;
      renderHistoryDetail();
    });
  }
  if (state.historyEditingChecklist) {
    bindChecklistEditors("#historyChecklistEditor");
    box.querySelector("#cancelHistoryChecklist")?.addEventListener("click", () => {
      state.historyEditingChecklist = false;
      renderHistoryDetail();
    });
    box.querySelector("#saveHistoryChecklist")?.addEventListener("click", async () => {
      try {
        await postJson("/api/checklist/save", {
          building: detail.building,
          items: collectChecklistValues("#historyChecklistEditor"),
        });
        await loadHistoryDetail(detail.building);
      } catch (error) {
        toast("#historyChecklistResult", error.message, "warn");
      }
    });
  }
}

function bindStaticEvents() {
  $("#primaryAction").addEventListener("click", handlePrimaryAction);
  $("#restartButton").addEventListener("click", restart);
  $("#adminLoginButton").addEventListener("click", handleAdminLogin);
  $("#adminPassword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleAdminLogin();
  });
  $("#adminLogoutButton").addEventListener("click", handleAdminLogout);
  $("#historyFilter").addEventListener("change", (event) => {
    state.historyFilter = event.target.value;
    renderHistory();
  });
  $("#historyMonthFilter").addEventListener("change", (event) => {
    setHistoryMonth(event.target.value);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.viewTab));
  });
}

function handleAdminLogin() {
  const password = $("#adminPassword").value.trim();
  if (password !== "8888") {
    toast("#adminLoginMessage", "비밀번호가 맞지 않습니다.", "warn");
    return;
  }
  $("#adminLogin").hidden = true;
  $("#adminPanel").hidden = false;
  $("#adminPassword").value = "";
  clearToast("#adminLoginMessage");
}

function handleAdminLogout() {
  $("#adminPanel").hidden = true;
  $("#adminLogin").hidden = false;
  clearToast("#adminLoginMessage");
}

async function bootstrap() {
  const data = await getJson("/api/bootstrap");
  state.sectors = data.sectors;
  $("#todayCompact").textContent = todayCompact(data.today);
  $("#workbookPath").textContent = data.workbook;
  const link = $("#spreadsheetLink");
  if (link && data.spreadsheetUrl) link.href = data.spreadsheetUrl;
  renderGroups();
  bindStaticEvents();
  setView("check");
  setPage("select");
}

bootstrap().catch((error) => alert(error.message));
