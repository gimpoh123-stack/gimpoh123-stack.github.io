const $ = (selector) => document.querySelector(selector);
const state = { restaurants: [] };

const colors = { "한식": "#167365", "중식": "#b64b35", "일식": "#315f86", "양식": "#8f6b28", "분식": "#c9653d", "카페": "#7a5f45", "기타": "#58636d" };
const preferred = {
  situations: ["혼밥", "친구와 식사", "가족 외식", "데이트"],
  tastes: ["초밥", "연어", "면", "국물", "매운", "든든한", "간단한", "가벼운", "특별한 식사", "일식", "중식", "분식", "카페"]
};

const els = {
  category: $("#category"),
  area: $("#area"),
  priceLevel: $("#priceLevel"),
  keyword: $("#keyword"),
  situationOptions: $("#situationOptions"),
  tasteOptions: $("#tasteOptions"),
  recommendButton: $("#recommendButton"),
  randomButton: $("#randomButton"),
  resetButton: $("#resetButton"),
  resultTitle: $("#resultTitle"),
  resultMeta: $("#resultMeta"),
  notice: $("#notice"),
  cards: $("#cards")
};

init();

async function init() {
  bindEvents();
  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error("data.json을 불러오지 못했습니다.");
    state.restaurants = await response.json();
    buildFilterOptions();
    renderEmpty();
  } catch (error) {
    els.resultMeta.textContent = "데이터 로딩 실패";
    els.cards.innerHTML = `<div class="empty"><div><h2>데이터를 불러오지 못했어요</h2><p>브라우저에서 파일을 직접 열었다면 로컬 서버로 실행해 주세요.</p></div></div>`;
  }
}

function bindEvents() {
  els.recommendButton.addEventListener("click", recommend);
  els.randomButton.addEventListener("click", recommendRandom);
  els.resetButton.addEventListener("click", reset);
}

function buildFilterOptions() {
  fillSelect(els.category, uniqueValues("category").filter(v => !v.startsWith("경기도")));
  fillSelect(els.area, uniqueValues("area"));
  fillSelect(els.priceLevel, uniqueValues("priceLevel"));
  fillChecks(els.situationOptions, "situation", orderedValues(uniqueArray(state.restaurants.flatMap((item) => item.situations || [])), preferred.situations));
  fillChecks(els.tasteOptions, "taste", orderedValues(uniqueArray(state.restaurants.flatMap(allTags)), preferred.tastes).slice(0, 12));
}

function uniqueValues(key) {
  return uniqueArray(state.restaurants.map((item) => item[key]).filter(Boolean)).sort((a, b) => a.localeCompare(b, "ko"));
}

function uniqueArray(values) { return [...new Set(values.filter(Boolean))]; }

function orderedValues(values, priority) {
  const head = priority.filter((value) => values.includes(value));
  const tail = values.filter((value) => !head.includes(value)).sort((a, b) => a.localeCompare(b, "ko"));
  return [...head, ...tail];
}

function fillSelect(select, values) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function fillChecks(container, name, values) {
  values.forEach((value) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" name="${name}" value="${escapeHtml(value)}">${escapeHtml(value)}`;
    container.append(label);
  });
}

function filters() {
  return {
    category: els.category.value,
    area: els.area.value,
    priceLevel: els.priceLevel.value,
    keyword: els.keyword.value.trim(),
    situations: checkedValues("situation"),
    tastes: checkedValues("taste")
  };
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function hasFilters(value) {
  return Boolean(value.category || value.area || value.priceLevel || value.keyword || value.situations.length || value.tastes.length);
}

function recommend() {
  const selected = filters();
  if (!hasFilters(selected)) {
    recommendRandom();
    return;
  }

  const items = scoreAll(selected).filter((item) => item.score > 0).sort(compareResults);
  if (items.length) {
    hideNotice();
    renderResults(items.slice(0, 8), "조건 추천 결과", `${items.length.toLocaleString("ko-KR")}개 후보를 점수순으로 정렬했습니다.`);
    return;
  }

  const fallback = relaxedRecommend(selected);
  showNotice(noResultMessage(selected, fallback.reason));
  renderResults(fallback.items, "대체 추천", fallback.meta);
}

function recommendRandom() {
  const items = shuffle(state.restaurants).slice(0, 3).map((restaurant) => ({ restaurant, score: 0, matched: ["랜덤 추천"], menu: restaurant.menus[0] }));
  hideNotice();
  renderResults(items, "랜덤 추천", "전체 데이터에서 무작위로 고른 후보입니다.");
}

function reset() {
  els.category.value = "";
  els.area.value = "";
  els.priceLevel.value = "";
  els.keyword.value = "";
  document.querySelectorAll("input[type='checkbox']").forEach((input) => { input.checked = false; });
  hideNotice();
  renderEmpty();
}

function scoreAll(selected) {
  return state.restaurants.map((restaurant) => {
    const result = scoreRestaurant(restaurant, selected);
    return { restaurant, score: result.score, matched: result.matched, menu: bestMenu(restaurant, selected) };
  });
}

function scoreRestaurant(restaurant, selected) {
  let score = 0;
  const matched = [];
  const tags = allTags(restaurant);
  const text = [restaurant.name, restaurant.area, restaurant.category, restaurant.address, restaurant.description, ...tags, ...restaurant.menus.map((menu) => menu.name)].join(" ").toLowerCase();

  if (selected.category && selected.category === restaurant.category) { score += 4; matched.push("음식 종류 +4"); }
  if (selected.area && selected.area === restaurant.area) { score += 3; matched.push("지역 +3"); }
  if (selected.priceLevel && selected.priceLevel === restaurant.priceLevel) { score += 3; matched.push("가격대 +3"); }

  selected.situations.forEach((situation) => {
    if ((restaurant.situations || []).includes(situation)) { score += 2; matched.push(`${situation} +2`); }
  });
  selected.tastes.forEach((taste) => {
    if (tags.includes(taste)) { score += 2; matched.push(`${taste} +2`); }
  });
  if (selected.keyword && text.includes(selected.keyword.toLowerCase())) { score += 2; matched.push("검색어 +2"); }

  return { score, matched };
}

function bestMenu(restaurant, selected) {
  return [...restaurant.menus].sort((a, b) => menuScore(b, selected) - menuScore(a, selected) || priceValue(a.price) - priceValue(b.price))[0];
}

function menuScore(menu, selected) {
  const text = `${menu.name} ${(menu.tags || []).join(" ")}`.toLowerCase();
  let score = 0;
  selected.tastes.forEach((taste) => { if ((menu.tags || []).includes(taste)) score += 2; });
  if (selected.keyword && text.includes(selected.keyword.toLowerCase())) score += 2;
  return score;
}

function relaxedRecommend(selected) {
  const steps = [
    { reason: "상황, 취향, 검색어를 빼고 핵심 조건만 다시 찾았어요.", filters: { ...selected, situations: [], tastes: [], keyword: "" } },
    { reason: "음식 종류와 지역만 남겨 다시 찾았어요.", filters: { ...selected, priceLevel: "", situations: [], tastes: [], keyword: "" } },
    { reason: "지역 조건만 남겨 다시 찾았어요.", filters: { category: "", area: selected.area, priceLevel: "", situations: [], tastes: [], keyword: "" } },
    { reason: "음식 종류만 남겨 다시 찾았어요.", filters: { category: selected.category, area: "", priceLevel: "", situations: [], tastes: [], keyword: "" } }
  ];

  for (const step of steps) {
    if (!hasFilters(step.filters)) continue;
    const items = scoreAll(step.filters).filter((item) => item.score > 0).sort(compareResults).slice(0, 3);
    if (items.length) return { items, reason: step.reason, meta: `${step.reason} ${items.length}개 후보를 보여드립니다.` };
  }

  return {
    items: shuffle(state.restaurants).slice(0, 3).map((restaurant) => ({ restaurant, score: 0, matched: ["전체 랜덤"], menu: restaurant.menus[0] })),
    reason: "완화 조건으로도 결과가 없어 전체 데이터에서 골랐어요.",
    meta: "전체 데이터에서 랜덤 후보 3개를 보여드립니다."
  };
}

function compareResults(a, b) {
  return b.score - a.score || priceValue(a.menu.price) - priceValue(b.menu.price) || Math.random() - 0.5;
}

function allTags(restaurant) {
  return [...new Set([...(restaurant.tags || []), ...(restaurant.situations || []), ...restaurant.menus.flatMap((menu) => menu.tags || [])])];
}

function renderResults(items, title, meta) {
  els.resultTitle.textContent = title;
  els.resultMeta.textContent = meta;
  els.cards.innerHTML = items.map(renderCard).join("");
}

function renderCard(item) {
  const { restaurant, score, matched, menu } = item;
  const color = colors[restaurant.category] || colors["기타"];
  const tags = allTags(restaurant).slice(0, 6);
  return `
    <article class="food-card">
      <div class="visual" style="--category-color: ${color}"><div><strong>${escapeHtml(restaurant.category)}</strong><span>${escapeHtml(restaurant.area)} · 이미지 대체 표시</span></div></div>
      <div class="food-body">
        <div class="card-top"><div><h3>${escapeHtml(restaurant.name)}</h3><div class="address">${escapeHtml(restaurant.address || restaurant.area)}</div></div><span class="score">${score ? `${score}점` : "랜덤"}</span></div>
        <div class="menu"><strong>${escapeHtml(menu.name)}</strong><span>${formatPrice(menu.price)}</span></div>
        <p class="desc">${escapeHtml(restaurant.description)}</p>
        <div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="tags">${matched.slice(0, 4).map((tag) => `<span class="tag match">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="links"><a href="${restaurant.mapUrl}" target="_blank" rel="noreferrer">지도 보기</a><a href="${restaurant.searchUrl}" target="_blank" rel="noreferrer">검색하기</a></div>
      </div>
    </article>`;
}

function renderEmpty() {
  els.resultTitle.textContent = "추천 결과";
  els.resultMeta.textContent = `${state.restaurants.length.toLocaleString("ko-KR")}개 일식 음식점 데이터를 불러왔습니다.`;
  els.cards.innerHTML = `<div class="empty"><div><h2>아직 추천 전입니다</h2><p>조건을 고르면 가까운 후보부터 보여드릴게요.</p></div></div>`;
}

function noResultMessage(selected, reason) {
  const values = [selected.category, selected.area, selected.priceLevel, ...selected.situations, ...selected.tastes, selected.keyword].filter(Boolean);
  return `정확히 일치하는 결과가 없습니다. 선택 조건: ${values.join(", ")}. ${reason}`;
}

function showNotice(message) { els.notice.hidden = false; els.notice.textContent = message; }
function hideNotice() { els.notice.hidden = true; els.notice.textContent = ""; }
function shuffle(items) { return [...items].sort(() => Math.random() - 0.5); }
function priceValue(price) { return typeof price === "number" ? price : Number.MAX_SAFE_INTEGER; }
function formatPrice(price) { return typeof price === "number" ? `${price.toLocaleString("ko-KR")}원` : "가격 확인 필요"; }
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

