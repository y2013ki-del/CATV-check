const SPREADSHEET_ID = "1d4oRFAL8jRHJHEHyGekSYV2l4MxY17XSFLEY2mhLPIQ";
const PLAN_SHEET = "계획점검 이행일";
const FIBER_SHEET = "CA_광선로 측정_2026";
const MEASURE_SHEETS = { K1: "K1 측정값", K2: "K2 측정값", "사외": "사외 측정값" };
const TIMEZONE = "Asia/Seoul";

const NAME_ALIASES = {
  "나노파크": ["나노파크 & 스포렉스", "나노파크&스포렉스"],
  "세미콘프라자": ["세미콘 프라자"],
};

const FORCED_MEASURE_BLOCKS = {
  "해피홈기숙사": { sheet: "사외 측정값", headerRow: 37, title: "해피홈기숙사" },
};

const SIGNAL_STEPS = [
  [3],
  [4],
  [7],
  [10],
  [13],
  [19],
  [25],
  [26, 27],
  [20, 21],
  [14, 15],
  [11, 12],
  [8, 9],
  [5, 6],
];

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action) return apiJsonp_(params);

  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("CATV 계획점검")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function apiJsonp_(params) {
  const callback = params.callback || "callback";
  let result;
  try {
    const payload = params.payload ? JSON.parse(params.payload) : {};
    result = runApiAction_(params.action, payload);
  } catch (error) {
    result = { ok: false, error: error.message || String(error) };
  }
  return ContentService.createTextOutput(callback + "(" + JSON.stringify(result) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function runApiAction_(action, payload) {
  switch (action) {
    case "bootstrap":
      return appBootstrap();
    case "history":
      return appHistory();
    case "historyDetail":
      return appHistoryDetail(payload.building);
    case "start":
      return appStart(payload);
    case "fiberSave":
      return appFiberSave(payload);
    case "signal":
      return appSignal(payload);
    case "signalSave":
      return appSignalSave(payload);
    case "checklist":
      return appChecklist(payload);
    case "checklistSave":
      return appChecklistSave(payload);
    case "note":
      return appNote(payload);
    case "noteSave":
      return appNoteSave(payload);
    default:
      throw new Error("지원하지 않는 action입니다: " + action);
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function appBootstrap() {
  const ss = openBook_();
  const now = today_();
  return {
    sectors: sectorsPayload_(ss),
    today: Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd"),
    month: Number(Utilities.formatDate(now, TIMEZONE, "M")),
    dayLabel: Utilities.formatDate(now, TIMEZONE, "dd") + "일",
    workbook: ss.getUrl(),
    spreadsheetUrl: ss.getUrl(),
  };
}

function appHistory() {
  return { ok: true, ...planHistoryPayload_(openBook_()) };
}

function appHistoryDetail(building) {
  return { ok: true, ...historyDetailPayload_(openBook_(), norm_(building)) };
}

function appStart(body) {
  const building = norm_(body && body.building);
  const ss = openBook_();
  const plan = ss.getSheetByName(PLAN_SHEET);
  const now = today_();
  const month = Number(Utilities.formatDate(now, TIMEZONE, "M"));
  const dayLabel = Utilities.formatDate(now, TIMEZONE, "dd") + "일";
  const planRow = findPlanRow_(plan, building);
  const monthCol = findMonthColumn_(plan, month);
  const region = activeRegion_(plan, planRow);
  plan.getRange(planRow, monthCol).setValue(dayLabel);
  return {
    ok: true,
    building,
    region,
    planRow,
    planColumn: columnLetter_(monthCol),
    written: dayLabel,
    measureSheet: MEASURE_SHEETS[region] || "",
  };
}

function appFiberSave(body) {
  const building = norm_(body && body.building);
  const values = (body && body.values) || {};
  const ss = openBook_();
  const ws = ss.getSheetByName(FIBER_SHEET);
  const row = findBuildingRow_(ws, building, 3);
  let changed = false;
  for (let col = 8; col <= 10; col += 1) {
    const key = columnLetter_(col);
    const next = numericOrText_(values[key] || "");
    const cell = ws.getRange(row, col);
    if (displayValue_(cell.getValue()) !== displayValue_(next)) changed = true;
    cell.setValue(next);
  }
  if (changed) ws.getRange(row, 4).setValue(today_()).setNumberFormat("yyyy-mm-dd");
  return { ok: true, changed, row, headers: fiberHeaders_(ws) };
}

function appSignal(body) {
  const building = norm_(body && body.building);
  const ss = openBook_();
  const plan = ss.getSheetByName(PLAN_SHEET);
  const planRow = findPlanRow_(plan, building);
  const region = activeRegion_(plan, planRow);
  const block = findMeasureBlock_(ss, region, building);
  if (!block) throw new Error(building + "에 연결된 측정값 블록을 찾을 수 없습니다.");
  const ws = ss.getSheetByName(block.sheet);
  const month = Number(Utilities.formatDate(today_(), TIMEZONE, "M"));
  const monthRow = findMonthRowInBlock_(ws, block.headerRow, month);
  return {
    ok: true,
    sheet: block.sheet,
    region,
    monthRow,
    headerRow: block.headerRow,
    totalSteps: 1,
    groups: signalInputGroups_(ws, monthRow, block.headerRow),
  };
}

function appSignalSave(body) {
  const building = norm_(body && body.building);
  const values = (body && body.values) || {};
  const ss = openBook_();
  const plan = ss.getSheetByName(PLAN_SHEET);
  const planRow = findPlanRow_(plan, building);
  const region = activeRegion_(plan, planRow);
  const block = findMeasureBlock_(ss, region, building);
  if (!block) throw new Error(building + "에 연결된 측정값 블록을 찾을 수 없습니다.");
  const ws = ss.getSheetByName(block.sheet);
  const month = Number(Utilities.formatDate(today_(), TIMEZONE, "M"));
  const monthRow = findMonthRowInBlock_(ws, block.headerRow, month);
  signalInputColumns_().forEach((col) => {
    const key = columnLetter_(col);
    const raw = values[key] || "";
    ws.getRange(monthRow, col).setValue(raw === "" ? "" : numericOrText_(raw));
  });
  return { ok: true, sheet: block.sheet, monthRow, nextStep: 1 };
}

function appChecklist(body) {
  const building = norm_(body && body.building);
  const ss = openBook_();
  const sheetName = findSheetName_(ss, building);
  if (!sheetName) return { ok: true, sheet: null, items: [] };
  const ws = ss.getSheetByName(sheetName);
  return { ok: true, sheet: sheetName, items: checklistItems_(ws) };
}

function appChecklistSave(body) {
  const building = norm_(body && body.building);
  const items = (body && body.items) || [];
  const ss = openBook_();
  const sheetName = findSheetName_(ss, building);
  if (!sheetName) throw new Error(building + " 건물 점검 시트를 찾을 수 없습니다.");
  const ws = ss.getSheetByName(sheetName);
  items.forEach((item) => {
    const row = Number(item.row);
    if (row >= 5 && row <= Math.min(ws.getLastRow(), 24)) {
      ws.getRange(row, 8).setValue(norm_(item.result));
    }
  });
  return { ok: true, sheet: sheetName, saved: items.length };
}

function appNote(body) {
  const building = norm_(body && body.building);
  const ss = openBook_();
  const plan = ss.getSheetByName(PLAN_SHEET);
  const planRow = findPlanRow_(plan, building);
  const region = activeRegion_(plan, planRow);
  const block = findMeasureBlock_(ss, region, building);
  if (!block) throw new Error(building + "에 연결된 측정값 블록을 찾을 수 없습니다.");
  const ws = ss.getSheetByName(block.sheet);
  const month = Number(Utilities.formatDate(today_(), TIMEZONE, "M"));
  const monthRow = findMonthRowInBlock_(ws, block.headerRow, month);
  return {
    ok: true,
    sheet: block.sheet,
    region,
    monthRow,
    monthLabel: norm_(ws.getRange(monthRow, 2).getValue()),
    values: {
      AB: displayValue_(ws.getRange(monthRow, 28).getValue()),
      AC: displayValue_(ws.getRange(monthRow, 29).getValue()),
      AD: displayValue_(ws.getRange(monthRow, 30).getValue()),
    },
    previous: {
      AB: displayValue_(previousNonblankInBlock_(ws, block.headerRow, monthRow, 28)),
    },
  };
}

function appNoteSave(body) {
  const building = norm_(body && body.building);
  const values = (body && body.values) || {};
  const inspector = norm_(body && body.inspector);
  const ss = openBook_();
  const plan = ss.getSheetByName(PLAN_SHEET);
  const planRow = findPlanRow_(plan, building);
  const region = activeRegion_(plan, planRow);
  const block = findMeasureBlock_(ss, region, building);
  if (!block) throw new Error(building + "에 연결된 측정값 블록을 찾을 수 없습니다.");
  const ws = ss.getSheetByName(block.sheet);
  const month = Number(Utilities.formatDate(today_(), TIMEZONE, "M"));
  const monthRow = findMonthRowInBlock_(ws, block.headerRow, month);
  const location = norm_(values.AB);
  const note = norm_(values.AC);
  const noteInspector = norm_(values.AD) || inspector;
  ws.getRange(monthRow, 28).setValue(location || previousNonblankInBlock_(ws, block.headerRow, monthRow, 28));
  ws.getRange(monthRow, 29).setValue(note);
  ws.getRange(monthRow, 30).setValue(noteInspector);
  return { ok: true, sheet: block.sheet, monthRow };
}

function openBook_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function today_() {
  return new Date();
}

function norm_(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\n/g, " ").trim();
}

function matchKey_(value) {
  return norm_(value).replace(/[\s()&・ㆍ/._-]+/g, "").toLowerCase();
}

function nameCandidates_(building) {
  return [building].concat(NAME_ALIASES[building] || []);
}

function namesMatch_(left, right) {
  const a = matchKey_(left);
  const b = matchKey_(right);
  return Boolean(a && b && a === b);
}

function activeRegion_(ws, row) {
  let value = "";
  const vals = ws.getRange(4, 2, row - 3, 1).getValues();
  vals.forEach((item) => {
    if (item[0]) value = item[0];
  });
  return norm_(value);
}

function findPlanRow_(ws, building) {
  const vals = ws.getRange(4, 3, 26, 1).getValues();
  for (let i = 0; i < vals.length; i += 1) {
    if (norm_(vals[i][0]) === building) return i + 4;
  }
  throw new Error("계획점검 이행일 C4:C29에서 '" + building + "'을 찾을 수 없습니다.");
}

function findMonthColumn_(ws, month) {
  const target = month + "월";
  const vals = ws.getRange(3, 1, 1, ws.getLastColumn()).getValues()[0];
  for (let i = 0; i < vals.length; i += 1) {
    if (norm_(vals[i]) === target) return i + 1;
  }
  throw new Error("계획점검 이행일 3행에서 '" + target + "'을 찾을 수 없습니다.");
}

function findMonthRowInBlock_(ws, headerRow, month) {
  const target = month + "월";
  const end = Math.min(headerRow + 14, ws.getLastRow());
  const vals = ws.getRange(headerRow + 3, 2, end - headerRow - 2, 1).getValues();
  for (let i = 0; i < vals.length; i += 1) {
    if (norm_(vals[i][0]) === target) return headerRow + 3 + i;
  }
  throw new Error(ws.getName() + " " + headerRow + "행 블록에서 '" + target + "'을 찾을 수 없습니다.");
}

function findBuildingRow_(ws, building, col) {
  const vals = ws.getRange(1, col, ws.getLastRow(), 1).getValues();
  const candidates = nameCandidates_(building);
  for (let i = 0; i < vals.length; i += 1) {
    if (candidates.some((candidate) => namesMatch_(vals[i][0], candidate))) return i + 1;
  }
  throw new Error(ws.getName() + " " + columnLetter_(col) + "열에서 '" + building + "'을 찾을 수 없습니다.");
}

function findSheetName_(ss, building) {
  const names = ss.getSheets().map((sheet) => sheet.getName());
  const candidates = nameCandidates_(building);
  for (const candidate of candidates) {
    if (names.indexOf(candidate) >= 0) return candidate;
  }
  return names.find((name) => namesMatch_(name, building)) || null;
}

function measureBlocks_(ws) {
  const vals = ws.getRange(1, 2, ws.getLastRow(), 1).getValues();
  const blocks = [];
  for (let i = 0; i < vals.length; i += 1) {
    if (norm_(vals[i][0]).indexOf("채널") === 0) {
      const row = i + 1;
      const title = row > 1 ? ws.getRange(row - 1, 2).getDisplayValue() : "";
      blocks.push({ headerRow: row, titleRow: row - 1, title: norm_(title) });
    }
  }
  return blocks;
}

function findMeasureBlock_(ss, region, building) {
  const forced = FORCED_MEASURE_BLOCKS[building];
  if (forced && ss.getSheetByName(forced.sheet)) return { ...forced, region };
  const sheetName = MEASURE_SHEETS[region];
  const ws = sheetName ? ss.getSheetByName(sheetName) : null;
  if (!ws) return null;
  const candidates = nameCandidates_(building);
  const found = measureBlocks_(ws).find((block) => candidates.some((candidate) => namesMatch_(block.title, candidate)));
  return found ? { ...found, sheet: sheetName, region } : null;
}

function sectorsPayload_(ss) {
  const ws = ss.getSheetByName(PLAN_SHEET);
  const vals = ws.getRange(4, 3, 26, 1).getValues();
  const rows = [];
  vals.forEach((item, idx) => {
    const building = norm_(item[0]);
    const row = idx + 4;
    if (building) rows.push({ row, building, region: activeRegion_(ws, row) });
  });
  return rows;
}

function planHistoryPayload_(ss) {
  const ws = ss.getSheetByName(PLAN_SHEET);
  const currentMonth = Number(Utilities.formatDate(today_(), TIMEZONE, "M"));
  const months = [];
  const monthCounts = {};
  for (let idx = 1; idx <= 12; idx += 1) {
    months.push({ month: idx, label: norm_(ws.getRange(3, idx + 3).getValue()) });
    monthCounts[String(idx)] = 0;
  }
  const rows = [];
  let currentMonthChecked = 0;
  const data = ws.getRange(4, 3, 26, 15).getValues();
  data.forEach((rowData, idx) => {
    const building = norm_(rowData[0]);
    if (!building) return;
    const checks = {};
    let checkedMonths = 0;
    for (let month = 1; month <= 12; month += 1) {
      const value = displayValue_(rowData[month]);
      checks[String(month)] = value;
      if (value !== "" && value !== null) {
        checkedMonths += 1;
        monthCounts[String(month)] += 1;
      }
    }
    if (checks[String(currentMonth)] !== "" && checks[String(currentMonth)] !== null) currentMonthChecked += 1;
    const sheetRow = idx + 4;
    rows.push({
      row: sheetRow,
      region: activeRegion_(ws, sheetRow),
      building,
      checks,
      checkedMonths,
    });
  });
  return {
    months,
    rows,
    summary: {
      totalBuildings: rows.length,
      currentMonth,
      checkedBuildings: currentMonthChecked,
      uncheckedBuildings: rows.length - currentMonthChecked,
      monthCounts,
    },
  };
}

function fiberHeaders_(ws) {
  const headers = [];
  for (let col = 8; col <= 10; col += 1) {
    headers.push({ col, letter: columnLetter_(col), label: norm_(ws.getRange(3, col).getValue()) });
  }
  return headers;
}

function signalHeaders_(ws, cols, headerRow) {
  return cols.map((col) => ({
    col,
    letter: columnLetter_(col),
    channel: norm_(ws.getRange(headerRow, col).getValue()),
    measure: norm_(ws.getRange(headerRow + 1, col).getValue()),
    kind: norm_(ws.getRange(headerRow + 2, col).getValue()),
  }));
}

function signalInputColumns_() {
  const cols = [];
  SIGNAL_STEPS.forEach((group) => {
    group.forEach((col) => {
      if (cols.indexOf(col) < 0) cols.push(col);
    });
  });
  return cols;
}

function signalMetricKey_(measure, kind) {
  if (kind === "신호값" || measure.indexOf("RF Power") >= 0) return "rf";
  if (kind === "EVM") return "evm";
  if (kind === "MER") return "mer";
  return "value";
}

function signalMetricTitle_(metric, measure, kind) {
  if (metric === "rf") return "RF";
  if (metric === "evm") return "EVM";
  if (metric === "mer") return "MER";
  return kind || measure || "값";
}

function signalInputGroups_(ws, row, headerRow) {
  const signalCols = signalInputColumns_();
  const groups = [];
  let current = null;
  for (let col = 3; col <= 27; col += 1) {
    const channel = norm_(ws.getRange(headerRow, col).getValue());
    if (channel) {
      current = { channel, metrics: [] };
      groups.push(current);
    }
    if (!current || signalCols.indexOf(col) < 0) continue;
    const measure = norm_(ws.getRange(headerRow + 1, col).getValue());
    const kind = norm_(ws.getRange(headerRow + 2, col).getValue());
    const metric = signalMetricKey_(measure, kind);
    current.metrics.push({
      col,
      letter: columnLetter_(col),
      metric,
      title: signalMetricTitle_(metric, measure, kind),
      measure,
      kind,
      value: displayValue_(ws.getRange(row, col).getValue()),
    });
  }
  return groups.filter((group) => group.metrics.length);
}

function previousNonblankInBlock_(ws, headerRow, beforeRow, col) {
  if (beforeRow <= headerRow + 3) return "";
  const vals = ws.getRange(headerRow + 3, col, beforeRow - headerRow - 3, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i -= 1) {
    if (vals[i][0] !== "" && vals[i][0] !== null) return vals[i][0];
  }
  return "";
}

function groupedMeasureValues_(ws, row, headerRow) {
  const groups = [];
  let current = null;
  for (let col = 3; col <= 27; col += 1) {
    const channel = norm_(ws.getRange(headerRow, col).getValue());
    if (channel) {
      current = { channel, rfPower: null, evm: null, mer: null, values: [] };
      groups.push(current);
    }
    if (!current) continue;
    const value = ws.getRange(row, col).getValue();
    if (value === "" || value === null) continue;
    const measure = norm_(ws.getRange(headerRow + 1, col).getValue());
    const kind = norm_(ws.getRange(headerRow + 2, col).getValue());
    current.values.push({ label: kind || measure, measure, kind, value: displayValue_(value) });
    if (kind === "신호값" || measure.indexOf("RF Power") >= 0) current.rfPower = displayValue_(value);
    else if (kind === "EVM") current.evm = displayValue_(value);
    else if (kind === "MER") current.mer = displayValue_(value);
  }
  return groups.filter((group) => group.values.length);
}

function checklistItems_(ws) {
  const end = Math.min(ws.getLastRow(), 24);
  const items = [];
  for (let row = 5; row <= end; row += 1) {
    const item = norm_(ws.getRange(row, 5).getValue());
    const result = displayValue_(ws.getRange(row, 8).getValue());
    if (item || (result !== "" && result !== null)) {
      items.push({
        row,
        category: norm_(ws.getRange(row, 2).getValue()),
        equipment: norm_(ws.getRange(row, 3).getValue()),
        item,
        method: norm_(ws.getRange(row, 6).getValue()),
        standard: norm_(ws.getRange(row, 7).getValue()),
        result,
      });
    }
  }
  return items;
}

function historyDetailPayload_(ss, building) {
  const plan = ss.getSheetByName(PLAN_SHEET);
  const planRow = findPlanRow_(plan, building);
  const region = activeRegion_(plan, planRow);
  const fiberWs = ss.getSheetByName(FIBER_SHEET);
  const fiberRow = findBuildingRow_(fiberWs, building, 3);
  const fiber = {
    sheet: FIBER_SHEET,
    row: fiberRow,
    lastDate: displayValue_(fiberWs.getRange(fiberRow, 4).getValue()),
    values: [8, 9, 10].map((col) => ({
      letter: columnLetter_(col),
      label: norm_(fiberWs.getRange(3, col).getValue()),
      value: displayValue_(fiberWs.getRange(fiberRow, col).getValue()),
    })),
  };

  let measurement = null;
  const block = findMeasureBlock_(ss, region, building);
  if (block) {
    const ws = ss.getSheetByName(block.sheet);
    const monthRows = [];
    const end = Math.min(block.headerRow + 14, ws.getLastRow());
    for (let row = block.headerRow + 3; row <= end; row += 1) {
      const monthLabel = norm_(ws.getRange(row, 2).getValue());
      if (!monthLabel) continue;
      const values = [];
      for (let col = 3; col <= 30; col += 1) {
        const value = ws.getRange(row, col).getValue();
        if (value === "" || value === null) continue;
        values.push({
          letter: columnLetter_(col),
          channel: norm_(ws.getRange(block.headerRow, col).getValue()),
          measure: norm_(ws.getRange(block.headerRow + 1, col).getValue()),
          kind: norm_(ws.getRange(block.headerRow + 2, col).getValue()),
          value: displayValue_(value),
        });
      }
      monthRows.push({
        row,
        month: monthLabel,
        filledCount: values.length,
        values,
        groups: groupedMeasureValues_(ws, row, block.headerRow),
        location: displayValue_(ws.getRange(row, 28).getValue()),
        note: displayValue_(ws.getRange(row, 29).getValue()),
        inspector: displayValue_(ws.getRange(row, 30).getValue()),
      });
    }
    measurement = {
      sheet: block.sheet,
      sheetBuilding: block.title || building,
      matchesBuilding: true,
      headerRow: block.headerRow,
      months: monthRows,
    };
  }

  let checklist = null;
  const buildingSheetName = findSheetName_(ss, building);
  if (buildingSheetName) {
    const ws = ss.getSheetByName(buildingSheetName);
    checklist = { sheet: buildingSheetName, items: checklistItems_(ws) };
  }

  return { building, region, fiber, measurement, checklist };
}

function numericOrText_(value) {
  if (value === null || value === undefined || value === "") return "-";
  const text = String(value).trim();
  const num = Number(text);
  return Number.isFinite(num) && text !== "" ? num : text;
}

function displayValue_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, TIMEZONE, "yyyy-MM-dd");
  if (value === null || value === undefined) return "";
  return value;
}

function columnLetter_(col) {
  let letter = "";
  while (col > 0) {
    const mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - mod) / 26);
  }
  return letter;
}
