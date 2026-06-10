const boardElement = document.getElementById("board");
const boardTabs = document.getElementById("boardTabs");
const resetButton = document.getElementById("resetButton");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const extensionModal = document.getElementById("extensionModal");
const closeModalButton = document.getElementById("closeModalButton");
const modalTitle = document.getElementById("modalTitle");
const modalCounter = document.getElementById("modalCounter");
const modalQuestion = document.getElementById("modalQuestion");
const modalAnswer = document.getElementById("modalAnswer");
const answerPanel = document.getElementById("answerPanel");
const revealAnswerButton = document.getElementById("revealAnswerButton");
const nextQuestionButton = document.getElementById("nextQuestionButton");
const boardWrap = boardElement.parentElement;
const boardZoomStage = document.createElement("div");
boardZoomStage.className = "board-zoom-stage";
boardElement.before(boardZoomStage);
boardZoomStage.appendChild(boardElement);

let topicData;
let activeBoardIndex = 0;
let activeSectionKey = null;
let activeQuestionIndex = 0;

const extensionQuestions = {};
const audioState = {};
const masteryState = new Set();
const highlightState = new Map();
const boardDisplayLayouts = new WeakMap();
const assetVersion = "20260607r-static-board-scroll-zoom";
const progressStoragePrefix = "summary-map-progress:";
const boardZoomStoragePrefix = "summary-map-board-zoom:";
const boardZoomLevels = [0.12, 0.18, 0.25, 0.35, 0.5, 0.75, 1];
let boardZoomIndex = boardZoomLevels.length - 1;
let currentStaticBoardWidth = 1440;
let currentStaticBoardHeight = 900;
let boardZoomLabel;
let zoomOutButton;
let zoomInButton;
let downloadButton;
let pdfWatermarkImagePromise;

function updateModalViewport() {
  if (!extensionModal) {
    return;
  }
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const left = viewport?.offsetLeft || 0;
  const top = viewport?.offsetTop || 0;
  extensionModal.style.setProperty("--modal-viewport-width", Math.max(0, width) + "px");
  extensionModal.style.setProperty("--modal-viewport-height", Math.max(0, height) + "px");
  extensionModal.style.setProperty("--modal-viewport-left", Math.max(0, left) + "px");
  extensionModal.style.setProperty("--modal-viewport-top", Math.max(0, top) + "px");
}

function withAssetVersion(path) {
  if (!path) {
    return path;
  }
  return path.includes("?") ? `${path}&v=${assetVersion}` : `${path}?v=${assetVersion}`;
}

function getBoardZoomStorageKey() {
  const topicKey = topicData && (topicData.folderName || topicData.code || topicData.title);
  return `${boardZoomStoragePrefix}${topicKey || location.pathname}`;
}

function getBoardZoom() {
  return boardZoomLevels[boardZoomIndex] || 1;
}

function loadStoredBoardZoom() {
  if (!topicData) {
    return;
  }
  try {
    const raw = localStorage.getItem(getBoardZoomStorageKey());
    const saved = Number.parseFloat(raw);
    const index = boardZoomLevels.findIndex((level) => Math.abs(level - saved) < 0.001);
    if (index >= 0) {
      boardZoomIndex = index;
    }
  } catch (error) {
    // Board zoom persistence is optional.
  }
}

function saveBoardZoom() {
  if (!topicData) {
    return;
  }
  try {
    localStorage.setItem(getBoardZoomStorageKey(), String(getBoardZoom()));
  } catch (error) {
    // Keep zoom working for this session if storage is blocked.
  }
}

function updateBoardZoomStageSize() {
  const zoom = getBoardZoom();
  boardElement.style.setProperty("--board-scale", zoom);
  boardZoomStage.style.width = `${currentStaticBoardWidth * zoom}px`;
  boardZoomStage.style.height = `${currentStaticBoardHeight * zoom}px`;
  if (boardZoomLabel) {
    boardZoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  if (zoomOutButton) {
    zoomOutButton.disabled = boardZoomIndex === 0;
  }
  if (zoomInButton) {
    zoomInButton.disabled = boardZoomIndex === boardZoomLevels.length - 1;
  }
}

function setBoardZoomIndex(index, options = {}) {
  const nextIndex = Math.max(0, Math.min(boardZoomLevels.length - 1, index));
  if (nextIndex === boardZoomIndex && !options.force) {
    return;
  }
  boardZoomIndex = nextIndex;
  updateBoardZoomStageSize();
  if (!options.skipSave) {
    saveBoardZoom();
  }
}

function sanitizePdfFilename(value) {
  return (value || "summary-map")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "summary-map";
}

function loadImageForPdf(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load " + src));
    image.src = withAssetVersion(src);
  });
}

function loadPdfWatermarkImage() {
  if (!pdfWatermarkImagePromise) {
    pdfWatermarkImagePromise = loadImageForPdf("../school crest watermark.png");
  }
  return pdfWatermarkImagePromise;
}

function drawPdfWatermark(context, canvas, watermarkImage) {
  if (!watermarkImage) {
    return;
  }
  const sourceWidth = watermarkImage.naturalWidth || watermarkImage.width;
  const sourceHeight = watermarkImage.naturalHeight || watermarkImage.height;
  if (!sourceWidth || !sourceHeight) {
    return;
  }
  const watermarkWidth = Math.max(76, Math.min(150, canvas.width * 0.07));
  const watermarkHeight = watermarkWidth * (sourceHeight / sourceWidth);
  context.save();
  context.globalAlpha = 0.32;
  context.drawImage(watermarkImage, 0, 0, watermarkWidth, watermarkHeight);
  context.restore();
}

function canvasToJpegBytes(canvas) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function renderBoardQuestionForPdf(board) {
  const image = await loadImageForPdf(board.questionSlide);
  const maxCanvasSide = 2200;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxCanvasSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    drawPdfWatermark(context, canvas, await loadPdfWatermarkImage());
  } catch (error) {
    // PDF downloads should still work if the optional watermark asset is unavailable.
  }
  return {
    title: board.title || "Board",
    width: canvas.width,
    height: canvas.height,
    jpegBytes: canvasToJpegBytes(canvas)
  };
}

function textToPdfBytes(text) {
  return new TextEncoder().encode(text);
}

function buildQuestionBoardsPdf(pages) {
  const chunks = [];
  const offsets = [0];
  let length = 0;
  let objectId = 1;
  const pageObjectIds = [];
  const pagesObjectId = objectId++;
  const catalogObjectId = objectId++;
  const pageDefs = pages.map((page) => ({
    ...page,
    pageObjectId: objectId++,
    contentObjectId: objectId++,
    imageObjectId: objectId++
  }));

  function write(part) {
    const bytes = typeof part === "string" ? textToPdfBytes(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  }

  function addObject(id, parts) {
    offsets[id] = length;
    write(id + " 0 obj\n");
    for (const part of parts) {
      write(part);
    }
    write("\nendobj\n");
  }

  write("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  for (const page of pageDefs) {
    const isLandscape = page.width >= page.height;
    const pageWidth = isLandscape ? 841.89 : 595.28;
    const pageHeight = isLandscape ? 595.28 : 841.89;
    const margin = 18;
    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;
    const scale = Math.min(availableWidth / page.width, availableHeight / page.height);
    const drawWidth = page.width * scale;
    const drawHeight = page.height * scale;
    const drawX = (pageWidth - drawWidth) / 2;
    const drawY = (pageHeight - drawHeight) / 2;
    const imageName = "Im" + page.imageObjectId;
    const content = "q\n" + drawWidth.toFixed(2) + " 0 0 " + drawHeight.toFixed(2) + " " + drawX.toFixed(2) + " " + drawY.toFixed(2) + " cm\n/" + imageName + " Do\nQ";

    addObject(page.imageObjectId, [
      "<< /Type /XObject /Subtype /Image /Width " + page.width + " /Height " + page.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + page.jpegBytes.length + " >>\nstream\n",
      page.jpegBytes,
      "\nendstream"
    ]);
    addObject(page.contentObjectId, [
      "<< /Length " + textToPdfBytes(content).length + " >>\nstream\n" + content + "\nendstream"
    ]);
    addObject(page.pageObjectId, [
      "<< /Type /Page /Parent " + pagesObjectId + " 0 R /MediaBox [0 0 " + pageWidth.toFixed(2) + " " + pageHeight.toFixed(2) + "] /Resources << /XObject << /" + imageName + " " + page.imageObjectId + " 0 R >> >> /Contents " + page.contentObjectId + " 0 R >>"
    ]);
    pageObjectIds.push(page.pageObjectId);
  }

  addObject(pagesObjectId, [
    "<< /Type /Pages /Kids [" + pageObjectIds.map((id) => id + " 0 R").join(" ") + "] /Count " + pageObjectIds.length + " >>"
  ]);
  addObject(catalogObjectId, [
    "<< /Type /Catalog /Pages " + pagesObjectId + " 0 R >>"
  ]);

  const xrefOffset = length;
  const maxObjectId = objectId - 1;
  write("xref\n0 " + (maxObjectId + 1) + "\n");
  write("0000000000 65535 f \n");
  for (let id = 1; id <= maxObjectId; id += 1) {
    write(String(offsets[id]).padStart(10, "0") + " 00000 n \n");
  }
  write("trailer\n<< /Size " + (maxObjectId + 1) + " /Root " + catalogObjectId + " 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF");

  const pdfBytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    pdfBytes.set(chunk, position);
    position += chunk.length;
  }
  return new Blob([pdfBytes], { type: "application/pdf" });
}

async function downloadQuestionBoardsPdf() {
  if (!topicData || !Array.isArray(topicData.boards) || !topicData.boards.length || !downloadButton) {
    return;
  }
  const originalContent = downloadButton.innerHTML;
  downloadButton.disabled = true;
  downloadButton.textContent = "...";
  try {
    const pages = [];
    for (const board of topicData.boards) {
      if (board.questionSlide) {
        pages.push(await renderBoardQuestionForPdf(board));
      }
    }
    if (!pages.length) {
      return;
    }
    const blob = buildQuestionBoardsPdf(pages);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = sanitizePdfFilename(topicData.title) + " question boards.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    downloadButton.innerHTML = originalContent;
    downloadButton.disabled = false;
  }
}

function createBoardZoomControls() {
  if (document.querySelector(".board-zoom-controls")) {
    return;
  }
  const tabRow = document.createElement("div");
  tabRow.className = "board-tabs-row";
  boardTabs.before(tabRow);
  tabRow.appendChild(boardTabs);
  const controls = document.createElement("div");
  controls.className = "board-zoom-controls";
  controls.setAttribute("aria-label", "Board zoom controls");
  zoomOutButton = document.createElement("button");
  zoomOutButton.type = "button";
  zoomOutButton.className = "board-zoom-button";
  zoomOutButton.textContent = "-";
  zoomOutButton.setAttribute("aria-label", "Zoom board out");
  zoomInButton = document.createElement("button");
  zoomInButton.type = "button";
  zoomInButton.className = "board-zoom-button";
  zoomInButton.textContent = "+";
  zoomInButton.setAttribute("aria-label", "Zoom board in");
  downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "board-download-button";
  downloadButton.innerHTML = '<svg class="download-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M12 12v6"></path><path d="m9 15 3 3 3-3"></path></svg><span class="download-label">PDF</span>';
  downloadButton.title = "Download question boards as PDF";
  downloadButton.setAttribute("aria-label", "Download question boards as PDF");
  boardZoomLabel = document.createElement("span");
  boardZoomLabel.className = "board-zoom-label";
  boardZoomLabel.setAttribute("aria-live", "polite");
  zoomOutButton.addEventListener("click", () => setBoardZoomIndex(boardZoomIndex - 1));
  zoomInButton.addEventListener("click", () => setBoardZoomIndex(boardZoomIndex + 1));
  downloadButton.addEventListener("click", downloadQuestionBoardsPdf);
  tabRow.appendChild(downloadButton);
  controls.append(zoomOutButton, boardZoomLabel, zoomInButton);
  tabRow.insertAdjacentElement("afterend", controls);
  updateBoardZoomStageSize();
}

function cardArea(card) {
  return card.questionBbox[2] * card.questionBbox[3];
}

function normalizeTitle(title) {
  return (title || "").trim().toLowerCase();
}

function containsCard(parent, child, tolerance = 0.01) {
  const [px, py, pw, ph] = parent.questionBbox;
  const [cx, cy, cw, ch] = child.questionBbox;
  return (
    cx >= px - tolerance &&
    cy >= py - tolerance &&
    cx + cw <= px + pw + tolerance &&
    cy + ch <= py + ph + tolerance
  );
}

function getBoardSpecificHiddenCardIds(board) {
  const topicCode = topicData && topicData.code;
  if (topicCode === "12" && board.id === "board-01") {
    return new Set([
      "period",
      "period-3-oxides-physical-chemical-properties"
    ]);
  }
  if (topicCode === "13" && board.id === "board-01") {
    return new Set(["group-17"]);
  }
  if (topicCode === "15" && board.id === "board-01") {
    return new Set(["ph", "ph-of-solutions"]);
  }
  if (topicCode === "16" && board.id === "board-01") {
    return new Set(["mechanism"]);
  }
  return new Set();
}

function buildBoardLayout(board) {
  const cards = board.cards.slice();
  const hiddenCardIds = getBoardSpecificHiddenCardIds(board);
  const staticParents = [];
  const groupedChildIds = new Set();
  const staticStandaloneCards = [];
  const byTitle = new Map();

  cards.forEach((card) => {
    const key = normalizeTitle(card.title);
    if (!byTitle.has(key)) {
      byTitle.set(key, []);
    }
    byTitle.get(key).push(card);
  });

  byTitle.forEach((group) => {
    if (group.length < 2) {
      return;
    }

    const parent = group.reduce((largest, card) => (cardArea(card) > cardArea(largest) ? card : largest), group[0]);
    if (topicData && topicData.code === "22a" && board.id === "board-01" && parent.id === "e-cell-and-spontaneity-parent") {
      return;
    }
    const siblings = group.filter((card) => card.id !== parent.id);
    const nestedSiblings = siblings.filter((card) => containsCard(parent, card, 0.012));
    if (!nestedSiblings.length) {
      return;
    }

    const children = cards.filter((card) => {
      if (card.id === parent.id || siblings.some((item) => item.id === card.id)) {
        return false;
      }
      if (cardArea(card) >= cardArea(parent) * 0.9) {
        return false;
      }
      return containsCard(parent, card, 0.012);
    });

    if (children.length < 2) {
      return;
    }

    staticParents.push({ parent, children });
    hiddenCardIds.add(parent.id);
    nestedSiblings.forEach((card) => hiddenCardIds.add(card.id));
    children.forEach((card) => groupedChildIds.add(card.id));
  });

  cards
    .slice()
    .sort((a, b) => cardArea(b) - cardArea(a))
    .forEach((parent) => {
      if (hiddenCardIds.has(parent.id) || groupedChildIds.has(parent.id)) {
        return;
      }
      if (cardArea(parent) < 0.18) {
        return;
      }
      const children = cards.filter((card) => {
        if (card.id === parent.id || hiddenCardIds.has(card.id) || groupedChildIds.has(card.id)) {
          return false;
        }
        if (cardArea(card) >= cardArea(parent) * 0.75) {
          return false;
        }
        return containsCard(parent, card, 0.01);
      });
      if (children.length < 2) {
        return;
      }
      staticParents.push({ parent, children });
      hiddenCardIds.add(parent.id);
      children.forEach((card) => groupedChildIds.add(card.id));
    });

  const addManualStaticParent = (parentId, childIds) => {
    const parent = cards.find((card) => card.id === parentId);
    if (!parent || hiddenCardIds.has(parent.id) || groupedChildIds.has(parent.id)) {
      return;
    }
    const children = childIds
      .map((childId) => cards.find((card) => card.id === childId))
      .filter(Boolean)
      .filter((card) => !hiddenCardIds.has(card.id) && !groupedChildIds.has(card.id));
    if (!children.length) {
      return;
    }
    staticParents.push({ parent, children });
    hiddenCardIds.add(parent.id);
    children.forEach((card) => groupedChildIds.add(card.id));
  };

  const topicCode = topicData && topicData.code;
  if (topicCode === "22b" && board.id === "board-01") {
    addManualStaticParent("selective-discharge-2", [
      "selective-discharge-factors",
      "how-to-deduce-which-species-is-preferentially-o-or-r",
      "selective-discharge-2-selective-discharge-eg"
    ]);
    addManualStaticParent("industrial-applications", [
      "industrial-applications-eg-1",
      "industrial-applications-eg-2"
    ]);
    addManualStaticParent("faraday-s-law", [
      "faraday-s-law-formula",
      "faraday-s-law-eg"
    ]);
  }

  const interactiveCards = cards.filter((card) => {
    if (hiddenCardIds.has(card.id)) {
      return false;
    }
    if (card.staticDisplay) {
      staticStandaloneCards.push(card);
      return false;
    }
    return true;
  });
  return { hiddenCardIds, groupedChildIds, staticParents, staticStandaloneCards, interactiveCards };
}

function getBoardLayout(board) {
  if (!board._layout) {
    board._layout = buildBoardLayout(board);
  }
  return board._layout;
}

function getProgressStorageKey() {
  const topicKey = topicData && (topicData.folderName || topicData.code || topicData.title);
  return `${progressStoragePrefix}${topicKey || "unknown-topic"}`;
}

function getProgressTotal() {
  if (!topicData) {
    return 0;
  }
  return topicData.boards.flatMap((board) => getBoardLayout(board).interactiveCards).length;
}

function loadStoredProgress() {
  if (!topicData) {
    return;
  }
  try {
    const raw = localStorage.getItem(getProgressStorageKey());
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.mastered)) {
      return;
    }
    masteryState.clear();
    saved.mastered.forEach((sectionKey) => {
      if (typeof sectionKey === "string") {
        masteryState.add(sectionKey);
      }
    });

    highlightState.clear();
    if (saved.highlights && typeof saved.highlights === "object" && !Array.isArray(saved.highlights)) {
      Object.entries(saved.highlights).forEach(([sectionKey, mode]) => {
        if (typeof sectionKey === "string" && (mode === "yellow" || mode === "green")) {
          highlightState.set(sectionKey, mode);
        }
      });
    }
  } catch (error) {
    // Progress persistence is optional; keep the app usable if storage is blocked.
  }
}

function publishProgress(total, masteredCount) {
  if (!topicData) {
    return;
  }

  const payload = {
    type: "summary-map-progress",
    topicCode: topicData.code,
    title: topicData.title,
    folderName: topicData.folderName,
    total,
    masteredCount,
    mastered: [...masteryState],
    highlights: Object.fromEntries(highlightState),
    updatedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(getProgressStorageKey(), JSON.stringify(payload));
  } catch (error) {
    // Ignore quota/private-mode failures; progress still works for this page session.
  }

  if (window.parent && window.parent !== window) {
    window.parent.postMessage(payload, "*");
  }
}

function getBoardDisplayLayout(board) {
  if (boardDisplayLayouts.has(board)) {
    return boardDisplayLayouts.get(board);
  }

  const layout = getBoardLayout(board);
  const railWidth = Math.max(72, board.width * 0.035);
  const rowGap = Math.max(44, board.height * 0.038);
  const minColumnGap = Math.max(28, railWidth * 0.34);
  const maxColumnGap = Math.max(minColumnGap, railWidth * 0.37);
  const displayCards = [
    ...layout.interactiveCards.filter((card) => !layout.groupedChildIds.has(card.id)),
    ...layout.staticStandaloneCards,
    ...layout.staticParents.map(({ parent }) => parent)
  ];

  const sourceMetrics = new Map();
  const visibleMetrics = displayCards.map((card) => {
    const metric = {
      card,
      x: card.questionBbox[0] * board.width,
      y: card.questionBbox[1] * board.height,
      w: card.questionBbox[2] * board.width,
      h: card.questionBbox[3] * board.height
    };
    metric.right = metric.x + metric.w;
    metric.bottom = metric.y + metric.h;
    metric.centerY = metric.y + metric.h / 2;
    sourceMetrics.set(card.id, metric);
    return metric;
  });

  if (!visibleMetrics.length) {
    const displayLayout = { expandedWidth: board.width, expandedHeight: board.height, cardBounds: new Map() };
    boardDisplayLayouts.set(board, displayLayout);
    return displayLayout;
  }

  const manualDisplayLayout = getManualBoardDisplayLayout(board, visibleMetrics, railWidth, rowGap, minColumnGap);
  if (manualDisplayLayout) {
    boardDisplayLayouts.set(board, manualDisplayLayout);
    return manualDisplayLayout;
  }

  const rows = [];
  visibleMetrics
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .forEach((metric) => {
      const matchingRow = rows.find((row) => {
        const topDistance = Math.abs(row.top - metric.y);
        const bottomDistance = Math.abs(row.bottom - metric.bottom);
        const centerDistance = Math.abs(row.centerY - metric.centerY);
        return topDistance < rowGap * 0.75 || bottomDistance < rowGap * 0.75 || centerDistance < rowGap * 0.75;
      });

      const row = matchingRow || { cards: [], top: metric.y, bottom: metric.bottom, height: metric.h, centerY: metric.centerY };
      if (!matchingRow) {
        rows.push(row);
      }
      row.cards.push(metric);
      row.top = Math.min(row.top, metric.y);
      row.bottom = Math.max(row.bottom, metric.bottom);
      row.height = Math.max(row.height, row.bottom - row.top);
      row.centerY = row.top + row.height / 2;
    });

  rows.sort((a, b) => a.top - b.top);
  rows.forEach((row, index) => {
    row.index = index;
    row.cards.sort((a, b) => a.x - b.x);
  });

  const leftMargin = Math.max(0, Math.min(...visibleMetrics.map((metric) => metric.x)));
  const targetWidth = Math.max(
    ...rows.map((row) => {
      const cardWidth = row.cards.reduce((sum, metric) => sum + metric.w + railWidth, 0);
      const gaps = Math.max(0, row.cards.length - 1) * minColumnGap;
      return leftMargin + cardWidth + gaps;
    })
  );

  const cardBounds = new Map();
  let maxRight = leftMargin;
  let maxBottom = 0;

  rows.forEach((row) => {
    const rowCardWidth = row.cards.reduce((sum, metric) => sum + metric.w + railWidth, 0);
    const packedGap = row.cards.length > 1
      ? Math.min(
          maxColumnGap,
          Math.max(minColumnGap, (targetWidth - leftMargin - rowCardWidth) / (row.cards.length - 1))
        )
      : 0;
    let cursorX = leftMargin;

    row.cards.forEach((metric) => {
      const displayY = metric.y + row.index * rowGap;
      cardBounds.set(metric.card.id, { x: cursorX, y: displayY, w: metric.w, h: metric.h });
      maxRight = Math.max(maxRight, cursorX + metric.w + railWidth);
      maxBottom = Math.max(maxBottom, displayY + metric.h);
      cursorX += metric.w + railWidth + packedGap;
    });
  });

  board.cards.forEach((card) => {
    if (cardBounds.has(card.id)) {
      return;
    }

    const metric = {
      x: card.questionBbox[0] * board.width,
      y: card.questionBbox[1] * board.height,
      w: card.questionBbox[2] * board.width,
      h: card.questionBbox[3] * board.height
    };
    const closestRow = rows.reduce((closest, row) => {
      const distance = Math.abs(row.top - metric.y);
      return !closest || distance < closest.distance ? { row, distance } : closest;
    }, null);
    const displayY = metric.y + ((closestRow && closestRow.row.index) || 0) * rowGap;

    cardBounds.set(card.id, { x: metric.x, y: displayY, w: metric.w, h: metric.h });
    maxBottom = Math.max(maxBottom, displayY + metric.h);
  });

  const displayLayout = { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
  boardDisplayLayouts.set(board, displayLayout);
  return displayLayout;
}

function getStaticBoardPixelWidth(board, displayLayout) {
  const topicCode = topicData && topicData.code;
  if (topicCode === "16" && board.id === "board-02") {
    return 864;
  }
  if (topicCode === "08") {
    return 1080;
  }
  if (board.height > board.width) {
    return 936;
  }
  return 1440;
}

function getMetricById(metrics, id) {
  return metrics.find((metric) => metric.card.id === id);
}

function getManualBoardDisplayLayout(board, metrics, railWidth, rowGap, minColumnGap) {
  const topicCode = topicData && topicData.code;

  if (topicCode === "15" && board.id === "board-02") {
    const staticTop = getMetricById(metrics, "titration-curves-static-top");
    const orderedIds = [
      "weak-acid-strong-base-e-g-ch-3-cooh-naoh",
      "weak-base-strong-acid",
      "polyprotic-acid-titration-curve"
    ];
    const ordered = [
      ...(staticTop ? [staticTop] : []),
      ...orderedIds.map((id) => getMetricById(metrics, id)).filter(Boolean)
    ];
    if (ordered.length) {
      const leftMargin = Math.max(0, Math.min(...ordered.map((metric) => metric.x)));
      const verticalGap = 17;
      const cardBounds = new Map();
      let cursorY = 0;
      ordered.forEach((metric) => {
        cardBounds.set(metric.card.id, { x: leftMargin, y: cursorY, w: metric.w, h: metric.h });
        cursorY += metric.h + verticalGap;
      });
      const maxRight = Math.max(...ordered.map((metric) => leftMargin + metric.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "01b" && board.id === "board-01") {
    const ids = {
      or: "deducing-o-or-r",
      formula: "deducing-oxidation-number-from-formula",
      structure: "deducing-oxidation-number-from-structure",
      balancing: "balancing-half-equations",
      summing: "summing-up-half-equations",
      solving: "solving-by-oxidation-numbers-or-e"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [orCard, formula, structure, balancing, summing, solving] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const cardBounds = new Map();
      let cursorX = leftMargin;
      [orCard, formula, structure].forEach((metric) => {
        cardBounds.set(metric.card.id, { x: cursorX, y: metric.y, w: metric.w, h: metric.h });
        cursorX += metric.w + railWidth + minColumnGap;
      });
      const lowerY = Math.max(...[orCard, formula, structure].map((metric) => metric.bottom)) + rowGap;
      const topRight = cardBounds.get(structure.card.id).x + structure.w;
      const rightColumnWidth = Math.max(summing.w, solving.w);
      const rightX = Math.max(leftMargin, topRight - rightColumnWidth);
      cardBounds.set(balancing.card.id, { x: leftMargin, y: lowerY, w: balancing.w, h: balancing.h });
      cardBounds.set(summing.card.id, { x: rightX, y: lowerY, w: summing.w, h: summing.h });
      cardBounds.set(solving.card.id, { x: rightX, y: lowerY + summing.h + rowGap * 0.55, w: solving.w, h: solving.h });
      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "02" && board.id === "board-01") {
    const ids = {
      deflection: "deflection-of-particles",
      proton: "proton-no-nucleon-no",
      orbital: "orbital-shapes",
      trends: "explaining-trends",
      electronic: "electronic-configuration-electron-in-box-energy-level",
      extra: "extra-practice-electronic-configuration"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [deflection, proton, orbital, trends, electronic, extra] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const cardBounds = new Map();
      let cursorX = leftMargin;
      [deflection, proton, orbital, trends].forEach((metric) => {
        cardBounds.set(metric.card.id, { x: cursorX, y: metric.y, w: metric.w, h: metric.h });
        cursorX += metric.w + railWidth + minColumnGap;
      });
      const compactRowGap = rowGap * 0.42;
      const lowerY = Math.max(...[deflection, proton, orbital].map((metric) => metric.bottom)) + compactRowGap;
      const trendsBounds = cardBounds.get(trends.card.id);
      const extraX = Math.max(leftMargin, trendsBounds.x + trendsBounds.w - extra.w);
      cardBounds.set(electronic.card.id, { x: leftMargin, y: lowerY, w: electronic.w, h: electronic.h });
      const extraY = Math.max(trendsBounds.y + trendsBounds.h + compactRowGap, lowerY + electronic.h - extra.h);
      cardBounds.set(extra.card.id, { x: extraX, y: extraY, w: extra.w, h: extra.h });
      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "08" && board.id === "board-01") {
    const ids = {
      hybridisation: "hybridisation-orbitals",
      effect: "effect-of-hybridisation-on-bond-strength-bond-length",
      delocalisation: "delocalisation-of-electrons-2"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [hybridisation, effect, delocalisation] = required;
      const scale = 1;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(hybridisation.y, effect.y));
      const verticalGap = 56;
      const rightX = leftMargin + hybridisation.w * scale + railWidth + minColumnGap;
      const cardBounds = new Map();
      cardBounds.set(hybridisation.card.id, {
        x: leftMargin,
        y: topY,
        w: hybridisation.w * scale,
        h: hybridisation.h * scale
      });
      cardBounds.set(effect.card.id, {
        x: rightX,
        y: topY,
        w: effect.w * scale,
        h: effect.h * scale
      });
      cardBounds.set(delocalisation.card.id, {
        x: rightX,
        y: topY + effect.h * scale + verticalGap,
        w: delocalisation.w * scale,
        h: delocalisation.h * scale
      });
      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "09" && board.id === "board-01") {
    const ids = {
      structural: "structural-formula",
      constitutional: "constitutional-isomerism",
      stereoisomerism: "stereoisomerism"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [structural, constitutional, stereoisomerism] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 38;
      const horizontalGap = Math.max(minColumnGap, 65);
      const rightX = leftMargin + constitutional.w + railWidth + horizontalGap;
      const cardBounds = new Map();

      cardBounds.set(structural.card.id, { x: leftMargin, y: topY, w: structural.w, h: structural.h });
      const lowerY = topY + structural.h + verticalGap;
      cardBounds.set(constitutional.card.id, {
        x: leftMargin,
        y: lowerY,
        w: constitutional.w,
        h: constitutional.h
      });
      cardBounds.set(stereoisomerism.card.id, {
        x: rightX,
        y: lowerY,
        w: stereoisomerism.w,
        h: stereoisomerism.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "10" && board.id === "board-01") {
    const ids = {
      reactions: "reactions",
      general: "explaining-general-reactivity",
      deducing: "deducing-no-of-isomers-from-frs",
      mechanism: "mechanism",
      factors: "factors-affecting-ratio-of-isomers-from-frs"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [reactions, general, deducing, mechanism, factors] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const leftWidth = Math.max(reactions.w, mechanism.w);
      const rightX = leftMargin + leftWidth + railWidth + minColumnGap;
      const cardBounds = new Map();

      cardBounds.set(reactions.card.id, { x: leftMargin, y: topY, w: reactions.w, h: reactions.h });
      cardBounds.set(mechanism.card.id, {
        x: leftMargin,
        y: topY + reactions.h + verticalGap,
        w: mechanism.w,
        h: mechanism.h
      });
      cardBounds.set(general.card.id, { x: rightX, y: topY, w: general.w, h: general.h });
      cardBounds.set(deducing.card.id, {
        x: rightX,
        y: topY + general.h + verticalGap,
        w: deducing.w,
        h: deducing.h
      });
      cardBounds.set(factors.card.id, {
        x: rightX,
        y: topY + general.h + verticalGap + deducing.h + verticalGap,
        w: factors.w,
        h: factors.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "11" && board.id === "board-01") {
    const ids = {
      reactions: "reactions",
      mechanism1: "mechanism",
      mechanism2: "mechanism-2",
      mechanism3: "mechanism-3"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [reactions, mechanism1, mechanism2, mechanism3] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 40;
      const rightX = leftMargin + reactions.w + railWidth + minColumnGap;
      const cardBounds = new Map();

      cardBounds.set(reactions.card.id, { x: leftMargin, y: topY, w: reactions.w, h: reactions.h });
      cardBounds.set(mechanism1.card.id, { x: rightX, y: topY, w: mechanism1.w, h: mechanism1.h });
      cardBounds.set(mechanism2.card.id, {
        x: rightX,
        y: topY + mechanism1.h + verticalGap,
        w: mechanism2.w,
        h: mechanism2.h
      });
      cardBounds.set(mechanism3.card.id, {
        x: rightX,
        y: topY + mechanism1.h + verticalGap + mechanism2.h + verticalGap,
        w: mechanism3.w,
        h: mechanism3.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "11" && board.id === "board-03") {
    const ids = {
      elimination: "deducing-products-from-elimination-reaction",
      redox: "balancing-redox-eq-n-with-h-or-o",
      physical: "physical-properties-of-cis-vs-trans"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [elimination, redox, physical] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const horizontalGap = 130;
      const verticalGap = 40;
      const rightX = leftMargin + elimination.w + railWidth + horizontalGap;
      const cardBounds = new Map();

      cardBounds.set(elimination.card.id, { x: leftMargin, y: topY, w: elimination.w, h: elimination.h });
      cardBounds.set(redox.card.id, { x: rightX, y: topY, w: redox.w, h: redox.h });
      cardBounds.set(physical.card.id, { x: rightX, y: topY + redox.h + verticalGap, w: physical.w, h: physical.h });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "12" && board.id === "board-01") {
    const ids = {
      physical: "period-3-elements-physical-properties",
      oxidesPhysical: "period-3-oxides-physical-properties",
      oxidesChemical: "period-3-oxides-chemical-properties"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [physical, oxidesPhysical, oxidesChemical] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 40;
      const cardBounds = new Map();

      cardBounds.set(physical.card.id, { x: leftMargin, y: topY, w: physical.w, h: physical.h });
      cardBounds.set(oxidesPhysical.card.id, {
        x: leftMargin,
        y: topY + physical.h + verticalGap,
        w: oxidesPhysical.w,
        h: oxidesPhysical.h
      });
      cardBounds.set(oxidesChemical.card.id, {
        x: leftMargin,
        y: topY + physical.h + verticalGap + oxidesPhysical.h + verticalGap,
        w: oxidesChemical.w,
        h: oxidesChemical.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "13" && board.id === "board-01") {
    const ids = {
      g2Physical: "trends-physical-properties",
      g2Chemical: "trends-chemical-group-2-chemical-properties",
      carbonates: "carbonates-thermal-stability",
      g17Physical: "trends-physical-properties-2",
      g17Chemical: "group-17-chemical-properties",
      hx: "hx-thermal-stability",
      displacement: "displacement-rxn",
      thiosulfate: "thiosulfate-rxn",
      fe: "fe-rxn",
      test: "test-for-x"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [
        g2Physical,
        g2Chemical,
        carbonates,
        g17Physical,
        g17Chemical,
        hx,
        displacement,
        thiosulfate,
        fe,
        test
      ] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const horizontalGap = 110;
      const verticalGap = 60;
      const sectionHeaderHeight = 70;
      const sectionHeaderLowerGap = 18;
      const sectionHeaderTopGap = 17;
      const leftWidth = Math.max(g2Physical.w, g17Physical.w, displacement.w);
      const middleWidth = Math.max(g2Chemical.w, g17Chemical.w, thiosulfate.w);
      const middleX = leftMargin + leftWidth + railWidth + horizontalGap;
      const rightX = middleX + middleWidth + railWidth + horizontalGap;
      const row1Y = topY;
      const row2Y =
        row1Y +
        Math.max(g2Physical.h, g2Chemical.h, carbonates.h) +
        sectionHeaderHeight +
        sectionHeaderLowerGap +
        sectionHeaderTopGap;
      const row3Y = row2Y + Math.max(g17Physical.h, g17Chemical.h, hx.h) + verticalGap;
      const testY = row3Y + Math.max(thiosulfate.h, fe.h) + verticalGap;
      const cardBounds = new Map();

      cardBounds.set(g2Physical.card.id, { x: leftMargin, y: row1Y, w: g2Physical.w, h: g2Physical.h });
      cardBounds.set(g2Chemical.card.id, { x: middleX, y: row1Y, w: g2Chemical.w, h: g2Chemical.h });
      cardBounds.set(carbonates.card.id, { x: rightX, y: row1Y, w: carbonates.w, h: carbonates.h });
      cardBounds.set(g17Physical.card.id, { x: leftMargin, y: row2Y, w: g17Physical.w, h: g17Physical.h });
      cardBounds.set(g17Chemical.card.id, { x: middleX, y: row2Y, w: g17Chemical.w, h: g17Chemical.h });
      cardBounds.set(hx.card.id, { x: rightX, y: row2Y, w: hx.w, h: hx.h });
      cardBounds.set(displacement.card.id, { x: leftMargin, y: row3Y, w: displacement.w, h: displacement.h });
      cardBounds.set(thiosulfate.card.id, { x: middleX, y: row3Y, w: thiosulfate.w, h: thiosulfate.h });
      cardBounds.set(fe.card.id, { x: rightX, y: row3Y, w: fe.w, h: fe.h });
      cardBounds.set(test.card.id, { x: middleX, y: testY, w: test.w, h: test.h });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "14" && board.id === "board-01") {
    const ids = {
      reactions: "reactions",
      why: "why-electrophilic-substitution",
      mechanism1: "mechanism",
      mechanism2: "mechanism-2",
      reactivity: "1-reactivity",
      directing: "2-directing-effect"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [reactions, why, mechanism1, mechanism2, reactivity, directing] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const horizontalGap = 34;
      const sectionHeaderHeight = 76;
      const sectionHeaderGap = 17;
      const middleWidth = Math.max(why.w, mechanism1.w, mechanism2.w);
      const rightWidth = Math.max(reactivity.w, directing.w);
      const middleX = leftMargin + reactions.w + railWidth + horizontalGap;
      const rightX = middleX + middleWidth + railWidth + horizontalGap;
      const whyContentY = topY + sectionHeaderHeight + sectionHeaderGap;
      const rightContentY = topY + sectionHeaderHeight + sectionHeaderGap;
      const mechanismsHeaderY = whyContentY + why.h + verticalGap;
      const mechanismsStartY = mechanismsHeaderY + sectionHeaderHeight + sectionHeaderGap;
      const cardBounds = new Map();

      cardBounds.set(reactions.card.id, { x: leftMargin, y: topY, w: reactions.w, h: reactions.h });
      cardBounds.set(why.card.id, { x: middleX, y: whyContentY, w: why.w, h: why.h });
      cardBounds.set(mechanism1.card.id, {
        x: middleX,
        y: mechanismsStartY,
        w: mechanism1.w,
        h: mechanism1.h
      });
      cardBounds.set(mechanism2.card.id, {
        x: middleX,
        y: mechanismsStartY + mechanism1.h + verticalGap,
        w: mechanism2.w,
        h: mechanism2.h
      });
      cardBounds.set(reactivity.card.id, { x: rightX, y: rightContentY, w: reactivity.w, h: reactivity.h });
      cardBounds.set(directing.card.id, {
        x: rightX,
        y: rightContentY + reactivity.h + verticalGap,
        w: directing.w,
        h: directing.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "15" && board.id === "board-01") {
    const ids = {
      acidBase: "acid-and-base",
      kaKb: "k-a-k-b-expressions",
      equations: "eqn",
      identifying: "identifying-types-of-solutions",
      ph1: "ph-of-solutions-1",
      ph2: "ph-of-solutions-2",
      ph3: "ph-of-solutions-3",
      ph4: "ph-of-solutions-4"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [acidBase, kaKb, equations, identifying, ph1, ph2, ph3, ph4] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const horizontalGap = 34;
      const sectionHeaderHeight = 70;
      const sectionHeaderGap = 17;
      const cardBounds = new Map();
      let cursorX = leftMargin;

      [acidBase, kaKb, equations, identifying].forEach((metric) => {
        cardBounds.set(metric.card.id, { x: cursorX, y: topY, w: metric.w, h: metric.h });
        cursorX += metric.w + railWidth + horizontalGap;
      });

      const phY = Math.max(...[acidBase, kaKb, equations, identifying].map((metric) => metric.h)) +
        topY + verticalGap + sectionHeaderHeight + sectionHeaderGap;
      cursorX = leftMargin;
      [ph1, ph2, ph3, ph4].forEach((metric) => {
        cardBounds.set(metric.card.id, { x: cursorX, y: phY, w: metric.w, h: metric.h });
        cursorX += metric.w + railWidth + horizontalGap;
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "23" && board.id === "board-01") {
    const ids = {
      definition: "definition",
      atomic: "atomic-trends",
      comparison: "comparison-with-s-block",
      complex: "complex-ligands",
      ligand: "ligand-exchange",
      orbital: "d-orbital-splitting-d-d-transition"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [definition, atomic, comparison, complex, ligand, orbital] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topGap = 46;
      const sectionGap = 34;
      const topLeftWidth = Math.max(definition.w, atomic.w);
      const lowerLeftWidth = Math.max(complex.w, ligand.w);
      const topRightX = leftMargin + topLeftWidth + railWidth + minColumnGap;
      const lowerRightX = leftMargin + lowerLeftWidth + railWidth + minColumnGap;
      const comparisonY = Math.max(0, comparison.y);
      const definitionY = comparisonY;
      const atomicY = definitionY + definition.h + topGap;
      const lowerY = Math.max(atomicY + atomic.h, comparisonY + comparison.h) + sectionGap;
      const cardBounds = new Map();

      cardBounds.set(definition.card.id, { x: leftMargin, y: definitionY, w: definition.w, h: definition.h });
      cardBounds.set(atomic.card.id, { x: leftMargin, y: atomicY, w: atomic.w, h: atomic.h });
      cardBounds.set(comparison.card.id, { x: topRightX, y: comparisonY, w: comparison.w, h: comparison.h });
      cardBounds.set(complex.card.id, { x: leftMargin, y: lowerY, w: complex.w, h: complex.h });
      cardBounds.set(ligand.card.id, {
        x: leftMargin,
        y: lowerY + complex.h + topGap,
        w: ligand.w,
        h: ligand.h
      });
      cardBounds.set(orbital.card.id, { x: lowerRightX, y: lowerY, w: orbital.w, h: orbital.h });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "15" && board.id === "board-02") {
    const ids = {
      staticTop: "titration-curves-static-top",
      weakAcid: "weak-acid-strong-base-e-g-ch-3-cooh-naoh",
      weakBase: "weak-base-strong-acid",
      polyprotic: "polyprotic-acid-titration-curve"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [staticTop, weakAcid, weakBase, polyprotic] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const contentWidth = Math.max(staticTop.w, weakAcid.w, weakBase.w, polyprotic.w);
      const cardBounds = new Map();

      cardBounds.set(staticTop.card.id, { x: leftMargin, y: topY, w: staticTop.w, h: staticTop.h });
      cardBounds.set(weakAcid.card.id, {
        x: leftMargin,
        y: topY + staticTop.h + verticalGap,
        w: weakAcid.w,
        h: weakAcid.h
      });
      cardBounds.set(weakBase.card.id, {
        x: leftMargin,
        y: topY + staticTop.h + verticalGap + weakAcid.h + verticalGap,
        w: weakBase.w,
        h: weakBase.h
      });
      cardBounds.set(polyprotic.card.id, {
        x: leftMargin,
        y: topY + staticTop.h + verticalGap + weakAcid.h + verticalGap + weakBase.h + verticalGap,
        w: polyprotic.w,
        h: polyprotic.h
      });

      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: leftMargin + contentWidth + railWidth, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "16" && board.id === "board-01") {
    const ids = {
      reactions: "reactions",
      mechanismSn1: "mechanism-sn1",
      mechanismSn2: "mechanism-sn2",
      snChoice: "s-n-1-or-s-n-2",
      relative: "relative-reactivities",
      chlorobenzene: "chlorobenzene"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [reactions, mechanismSn1, mechanismSn2, snChoice, relative, chlorobenzene] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const horizontalGap = 34;
      const sectionHeaderHeight = 76;
      const sectionHeaderGap = 17;
      const mechanismWidth = Math.max(mechanismSn1.w, mechanismSn2.w);
      const rightWidth = Math.max(snChoice.w, relative.w, chlorobenzene.w);
      const mechanismX = leftMargin + reactions.w + railWidth + horizontalGap;
      const rightX = mechanismX + mechanismWidth + railWidth + horizontalGap;
      const mechanismStartY = topY + sectionHeaderHeight + sectionHeaderGap;
      const cardBounds = new Map();

      cardBounds.set(reactions.card.id, { x: leftMargin, y: topY, w: reactions.w, h: reactions.h });
      cardBounds.set(mechanismSn1.card.id, {
        x: mechanismX,
        y: mechanismStartY,
        w: mechanismSn1.w,
        h: mechanismSn1.h
      });
      cardBounds.set(mechanismSn2.card.id, {
        x: mechanismX,
        y: mechanismStartY + mechanismSn1.h + verticalGap,
        w: mechanismSn2.w,
        h: mechanismSn2.h
      });
      cardBounds.set(snChoice.card.id, { x: rightX, y: topY, w: snChoice.w, h: snChoice.h });
      cardBounds.set(relative.card.id, {
        x: rightX,
        y: topY + snChoice.h + verticalGap,
        w: relative.w,
        h: relative.h
      });
      cardBounds.set(chlorobenzene.card.id, {
        x: rightX,
        y: topY + snChoice.h + verticalGap + relative.h + verticalGap,
        w: chlorobenzene.w,
        h: chlorobenzene.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "17" && board.id === "board-01") {
    const ids = {
      reactions: "reactions",
      oxidation: "oxidation",
      acidity: "relative-acidity",
      tests: "distinguishing-tests"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [reactions, oxidation, acidity, tests] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const horizontalGap = 34;
      const rightX = leftMargin + reactions.w + railWidth + horizontalGap;
      const cardBounds = new Map();

      cardBounds.set(reactions.card.id, { x: leftMargin, y: topY, w: reactions.w, h: reactions.h });
      cardBounds.set(oxidation.card.id, { x: rightX, y: topY, w: oxidation.w, h: oxidation.h });
      cardBounds.set(acidity.card.id, {
        x: rightX,
        y: topY + oxidation.h + verticalGap,
        w: acidity.w,
        h: acidity.h
      });
      cardBounds.set(tests.card.id, {
        x: rightX,
        y: topY + oxidation.h + verticalGap + acidity.h + verticalGap,
        w: tests.w,
        h: tests.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "18" && board.id === "board-01") {
    const ids = {
      reactions: "reactions",
      mechanism: "mechanism",
      tests: "distinguishing-tests",
      agents: "oxidising-reducing-agents",
      reactivity: "reactivity"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [reactions, mechanism, tests, agents, reactivity] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const horizontalGap = 34;
      const middleWidth = Math.max(mechanism.w, reactivity.w);
      const middleX = leftMargin + reactions.w + railWidth + horizontalGap;
      const rightX = middleX + middleWidth + railWidth + horizontalGap;
      const cardBounds = new Map();

      cardBounds.set(reactions.card.id, { x: leftMargin, y: topY, w: reactions.w, h: reactions.h });
      cardBounds.set(mechanism.card.id, { x: middleX, y: topY, w: mechanism.w, h: mechanism.h });
      cardBounds.set(reactivity.card.id, {
        x: middleX,
        y: topY + mechanism.h + verticalGap,
        w: reactivity.w,
        h: reactivity.h
      });
      cardBounds.set(tests.card.id, { x: rightX, y: topY, w: tests.w, h: tests.h });
      cardBounds.set(agents.card.id, {
        x: rightX,
        y: topY + tests.h + verticalGap,
        w: agents.w,
        h: agents.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "19" && board.id === "board-01") {
    const ids = {
      reactions: "reactions",
      hydrolysis: "hydrolysis",
      acidity: "relative-acidity",
      ease: "ease-of-hydrolysis"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [reactions, hydrolysis, acidity, ease] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const horizontalGap = 34;
      const leftWidth = Math.max(reactions.w, hydrolysis.w);
      const rightX = leftMargin + leftWidth + railWidth + horizontalGap;
      const cardBounds = new Map();

      cardBounds.set(reactions.card.id, { x: leftMargin, y: topY, w: reactions.w, h: reactions.h });
      cardBounds.set(hydrolysis.card.id, {
        x: leftMargin,
        y: topY + reactions.h + verticalGap,
        w: hydrolysis.w,
        h: hydrolysis.h
      });
      cardBounds.set(acidity.card.id, { x: rightX, y: topY, w: acidity.w, h: acidity.h });
      cardBounds.set(ease.card.id, {
        x: rightX,
        y: topY + acidity.h + verticalGap,
        w: ease.w,
        h: ease.h
      });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "22a" && board.id === "board-01") {
    const ids = {
      setup: "electrochemical-cell-setup",
      halfCell: "half-cell-systems",
      electrode: "standard-electrode-potential-e-2",
      cellPotential: "standard-cell-potential-e-cell-2",
      poe: "effects-of-poe-shift",
      spontaneity: "e-cell-and-spontaneity-parent"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [setup, halfCell, electrode, cellPotential, poe, spontaneity] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(...metrics.map((metric) => metric.y)));
      const verticalGap = 17;
      const horizontalGap = 34;
      const leftWidth = Math.max(electrode.w, cellPotential.w, halfCell.w);
      const middleWidth = Math.max(setup.w, poe.w);
      const middleX = leftMargin + leftWidth + railWidth + horizontalGap;
      const rightX = middleX + middleWidth + railWidth + horizontalGap;
      const cardBounds = new Map();

      cardBounds.set(electrode.card.id, { x: leftMargin, y: topY, w: electrode.w, h: electrode.h });
      cardBounds.set(cellPotential.card.id, {
        x: leftMargin,
        y: topY + electrode.h + verticalGap,
        w: cellPotential.w,
        h: cellPotential.h
      });
      cardBounds.set(halfCell.card.id, {
        x: leftMargin,
        y: topY + electrode.h + verticalGap + cellPotential.h + verticalGap,
        w: halfCell.w,
        h: halfCell.h
      });
      cardBounds.set(setup.card.id, { x: middleX, y: topY, w: setup.w, h: setup.h });
      cardBounds.set(poe.card.id, {
        x: middleX,
        y: topY + setup.h + verticalGap,
        w: poe.w,
        h: poe.h
      });
      cardBounds.set(spontaneity.card.id, { x: rightX, y: topY, w: spontaneity.w, h: spontaneity.h });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "22b" && board.id === "board-01") {
    const ids = {
      selective: "selective-discharge-2",
      setup: "electrolytic-cell-setup-2",
      industrial: "industrial-applications",
      faraday: "faraday-s-law"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [selective, setup, industrial, faraday] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const topY = Math.max(0, Math.min(selective.y, setup.y, faraday.y));
      const verticalGap = 17;
      const horizontalGap = 34;
      const middleWidth = Math.max(setup.w, industrial.w);
      const middleX = leftMargin + selective.w + railWidth + horizontalGap;
      const rightX = middleX + middleWidth + railWidth + horizontalGap;
      const cardBounds = new Map();

      cardBounds.set(selective.card.id, { x: leftMargin, y: topY, w: selective.w, h: selective.h });
      cardBounds.set(setup.card.id, { x: middleX, y: topY, w: setup.w, h: setup.h });
      cardBounds.set(industrial.card.id, {
        x: middleX,
        y: topY + setup.h + verticalGap,
        w: industrial.w,
        h: industrial.h
      });
      cardBounds.set(faraday.card.id, { x: rightX, y: topY, w: faraday.w, h: faraday.h });

      const maxRight = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.x + bounds.w + railWidth));
      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: maxRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  if (topicCode === "03" && board.id === "board-03") {
    const ids = {
      further: "further-classification-of-bonds",
      imf: "intermolecular-forces-of-attraction-imf",
      melting: "melting-boiling",
      solubility: "solubility"
    };
    const required = Object.values(ids).map((id) => getMetricById(metrics, id));
    if (required.every(Boolean)) {
      const [further, imf, melting, solubility] = required;
      const leftMargin = Math.max(0, Math.min(...metrics.map((metric) => metric.x)));
      const bottomRowWidth = melting.w + railWidth + minColumnGap + solubility.w + railWidth;
      const targetWidth = Math.max(further.w, imf.w, bottomRowWidth);
      const parentWidth = targetWidth - railWidth * 0.28;
      const targetRight = leftMargin + targetWidth;
      const cardBounds = new Map();

      cardBounds.set(further.card.id, { x: leftMargin, y: further.y, w: parentWidth, h: further.h });
      cardBounds.set(imf.card.id, { x: leftMargin, y: imf.y + rowGap, w: parentWidth, h: imf.h });
      cardBounds.set(melting.card.id, { x: leftMargin, y: melting.y + rowGap * 2, w: melting.w, h: melting.h });
      cardBounds.set(solubility.card.id, {
        x: targetRight - railWidth - solubility.w,
        y: solubility.y + rowGap * 2,
        w: solubility.w,
        h: solubility.h
      });

      const maxBottom = Math.max(...Array.from(cardBounds.values()).map((bounds) => bounds.y + bounds.h));
      return { expandedWidth: targetRight, expandedHeight: maxBottom, cardBounds };
    }
  }

  return null;
}

function getCardDisplayBounds(board, card) {
  const displayLayout = getBoardDisplayLayout(board);
  const bounds = displayLayout.cardBounds.get(card.id) || {
    x: card.questionBbox[0] * board.width,
    y: card.questionBbox[1] * board.height,
    w: card.questionBbox[2] * board.width,
    h: card.questionBbox[3] * board.height
  };
  return {
    x: bounds.x / displayLayout.expandedWidth,
    y: bounds.y / displayLayout.expandedHeight,
    w: bounds.w / displayLayout.expandedWidth,
    h: bounds.h / displayLayout.expandedHeight
  };
}

function getStaticParentFrame(parent, children) {
  const [px, py, pw, ph] = parent.questionBbox;
  const presetsById = {
    "delocalisation-of-electrons-2": { bodyX: 0, bodyY: 0, bodyW: 1, bodyH: 1 },
    "stereoisomerism": { bodyX: 0, bodyY: 0, bodyW: 1, bodyH: 1 },
    "predicting-precipitation-quantitative": { bodyX: 0, bodyY: 0, bodyW: 1, bodyH: 1 },
    "e-cell-and-spontaneity-parent": { bodyX: 0, bodyY: 0, bodyW: 1, bodyH: 1 }
  };
  const idPreset = presetsById[parent.id];
  if (idPreset) {
    return {
      x: px + pw * idPreset.bodyX,
      y: py + ph * idPreset.bodyY,
      w: pw * idPreset.bodyW,
      h: ph * idPreset.bodyH
    };
  }

  const key = normalizeTitle(parent.title);
  const presets = {
    "application of vsepr": { bodyX: 0.006, bodyY: 0.09, bodyW: 0.99, bodyH: 0.9 },
    "structure and bonding": { bodyX: 0.006, bodyY: 0.085, bodyW: 0.99, bodyH: 0.905 },
    "further classification of bonds": { bodyX: 0.004, bodyY: 0.132, bodyW: 0.992, bodyH: 0.858 },
    "intermolecular forces of attraction (imf)": { bodyX: 0.004, bodyY: 0.078, bodyW: 0.992, bodyH: 0.912 },
    "boltzmann distribution": { bodyX: 0.012, bodyY: 0.096, bodyW: 0.94, bodyH: 0.882 },
    "common methods to deduce order of reaction": { bodyX: 0.01, bodyY: 0.096, bodyW: 0.98, bodyH: 0.882 },
    "catalysis": { bodyX: 0.01, bodyY: 0.07, bodyW: 0.98, bodyH: 0.918 }
  };

  const preset = presets[key];
  if (preset) {
    return {
      x: px + pw * preset.bodyX,
      y: py + ph * preset.bodyY,
      w: pw * preset.bodyW,
      h: ph * preset.bodyH
    };
  }

  const minX = Math.min(...children.map((child) => child.questionBbox[0]));
  const minY = Math.min(...children.map((child) => child.questionBbox[1]));
  const maxX = Math.max(...children.map((child) => child.questionBbox[0] + child.questionBbox[2]));
  const maxY = Math.max(...children.map((child) => child.questionBbox[1] + child.questionBbox[3]));
  const sidePad = Math.min(pw * 0.012, 0.01);
  const topPad = Math.min(ph * 0.012, 0.008);
  const bottomPad = Math.min(ph * 0.018, 0.012);
  return {
    x: Math.max(px, minX - sidePad),
    y: Math.max(py, minY - topPad),
    w: Math.max(0.001, Math.min(px + pw, maxX + sidePad) - Math.max(px, minX - sidePad)),
    h: Math.max(0.001, Math.min(py + ph, maxY + bottomPad) - Math.max(py, minY - topPad))
  };
}

function getGroupedSlotOverrides(parent) {
  if (parent.id === "application-of-vsepr-2") {
    return {
      "example-1": { x: 0.022, y: 0.071, w: 0.2735, h: 0.8 },
      "example-2": { x: 0.3517, y: 0.071, w: 0.2746, h: 0.8 },
      "example-3": { x: 0.682, y: 0.071, w: 0.2735, h: 0.8 }
    };
  }
  if (parent.id === "structure-and-bonding-2") {
    return {
      "giant-ionic-lattice": { x: 0.024, y: 0.066, w: 0.225, h: 0.816 },
      "giant-metallic-lattice": { x: 0.2655, y: 0.066, w: 0.225, h: 0.816 },
      "giant-molecular-structure": { x: 0.5117, y: 0.066, w: 0.225, h: 0.816 },
      "simple-molecular-structure": { x: 0.7542, y: 0.066, w: 0.225, h: 0.816 }
    };
  }
  if (parent.id === "further-classification-of-bonds") {
    return {
      "sigma-and-pi-bonds": { x: 0.0215, y: 0.135, w: 0.13, h: 0.73 },
      "dative-covalent-bond": { x: 0.1755, y: 0.135, w: 0.25, h: 0.73 },
      "ionic-bond-with-covalent-character": { x: 0.4311, y: 0.135, w: 0.385, h: 0.73 },
      "polar-bonds": { x: 0.8081, y: 0.135, w: 0.16, h: 0.73 }
    };
  }
  if (parent.id === "intermolecular-forces-of-attraction-imf") {
    return {
      "id-id": { x: 0.0208, y: 0.075, w: 0.24, h: 0.815 },
      "pd-pd": { x: 0.2726, y: 0.075, w: 0.25, h: 0.815 },
      "h-bond": { x: 0.5354, y: 0.094, w: 0.445, h: 0.777 }
    };
  }
  if (parent.id === "boltzmann-distribution") {
    return {
      "boltzmann-distribution-temp": { x: 0.01, y: 0.014, w: 0.45, h: 0.966 },
      "boltzmann-distribution-catalyst": { x: 0.525, y: 0.012, w: 0.448, h: 0.97 }
    };
  }
  if (parent.id === "common-methods-to-deduce-order-of-reaction") {
    return {
      "common-methods-to-deduce-order-of-reaction-initial-rate-method": { x: 0.01, y: 0.014, w: 0.456, h: 0.966 },
      "common-methods-to-deduce-order-of-reaction-t-half-method": { x: 0.508, y: 0.014, w: 0.212, h: 0.966 },
      "common-methods-to-deduce-order-of-reaction-graph-shape-method": { x: 0.758, y: 0.014, w: 0.209, h: 0.966 }
    };
  }
  if (parent.id === "catalysis") {
    return {
      "catalysis-homogenous": { x: 0.01, y: 0.008, w: 0.294, h: 0.982 },
      "catalysis-heterogenous": { x: 0.367, y: 0.008, w: 0.316, h: 0.982 },
      "catalysis-unique": { x: 0.747, y: 0.008, w: 0.213, h: 0.982 }
    };
  }
  if (parent.id === "stereoisomerism") {
    return {
      "stereoisomerism-enantiomerism": { x: 0.055, y: 0.125, w: 0.787, h: 0.464 },
      "stereoisomerism-cis-trans": { x: 0.055, y: 0.612, w: 0.787, h: 0.358 }
    };
  }

  return null;
}

function getGroupedExtraMasks(parent) {
  if (parent.id === "boltzmann-distribution") {
    return [
      { x: 0.48, y: 0.012, w: 0.038, h: 0.97 }
    ];
  }
  if (parent.id === "stereoisomerism") {
    return [
      { x: 0.018, y: 0.114, w: 0.96, h: 0.5 },
      { x: 0.02, y: 0.595, w: 0.958, h: 0.39 }
    ];
  }
  return [];
}

function getGroupedSlotBounds(card, contentBox, parent, board) {
  const manualSlots = parent ? getGroupedSlotOverrides(parent) : null;
  if (manualSlots && manualSlots[card.id]) {
    const parentBounds = getBoardDisplayLayout(board).cardBounds.get(parent.id);
    const contentRelW = contentBox.w / Math.max(0.001, parent.questionBbox[2]);
    const contentRelH = contentBox.h / Math.max(0.001, parent.questionBbox[3]);
    const contentPixelRatio = (parentBounds.w * contentRelW) / Math.max(0.001, parentBounds.h * contentRelH);
    return fitGroupedSlotToCrop(card, manualSlots[card.id], contentPixelRatio);
  }

  const relX = (card.questionBbox[0] - contentBox.x) / contentBox.w;
  const relY = (card.questionBbox[1] - contentBox.y) / contentBox.h;
  const relW = card.questionBbox[2] / contentBox.w;
  const relH = card.questionBbox[3] / contentBox.h;

  return {
    x: relX,
    y: relY,
    w: relW,
    h: relH
  };
}

function imageSizeRatio(size) {
  return Array.isArray(size) && size.length === 2 && size[0] > 0 && size[1] > 0
    ? size[0] / size[1]
    : null;
}

function bboxPixelRatio(bbox, board) {
  return (bbox[2] * board.width) / Math.max(0.001, bbox[3] * board.height);
}

function fitGroupedSlotToCrop(card, slot, contentPixelRatio) {
  const cropRatio =
    imageSizeRatio(card.questionImageSize) ||
    imageSizeRatio(card.answerImageSize) ||
    1;
  const fitted = { ...slot };
  fitted.w = Math.max(0.001, fitted.h * (cropRatio / Math.max(0.001, contentPixelRatio)));
  if (fitted.x + fitted.w > 1) {
    fitted.x = Math.max(0, 1 - fitted.w);
  }
  if (fitted.y + fitted.h > 1) {
    fitted.y = Math.max(0, 1 - fitted.h);
  }
  return fitted;
}

function createCardElement(card, board, options = {}) {
  const { grouped = false, parent = null, contentBox = null } = options;
  const sectionKey = modalKey(board.id, card.id);
  const article = document.createElement("article");
  article.className = grouped ? "nested-section-card is-group-child" : "section-card controls-right";
  if (!card.audioFile) {
    article.classList.add("no-audio");
  }
  article.dataset.section = sectionKey;

  if (grouped && parent && contentBox) {
    const bounds = getGroupedSlotBounds(card, contentBox, parent, board);
    article.style.setProperty("--x", bounds.x);
    article.style.setProperty("--y", bounds.y);
    article.style.setProperty("--w", bounds.w);
    article.style.setProperty("--h", bounds.h);
  } else {
    const bounds = getCardDisplayBounds(board, card);
    article.style.setProperty("--x", bounds.x);
    article.style.setProperty("--y", bounds.y);
    article.style.setProperty("--w", bounds.w);
    article.style.setProperty("--h", bounds.h);
  }

  article.innerHTML = `
    <button class="flip-trigger" type="button" aria-pressed="false" aria-label="Reveal answer for ${card.title}">
      <span class="sr-only">Reveal answer for ${card.title}</span>
      <span class="card-face card-front">
        <img src="${withAssetVersion(card.questionImage)}" alt="${card.title} question section">
      </span>
      <span class="card-face card-back">
        <img src="${withAssetVersion(card.answerImage)}" alt="${card.title} answer section">
      </span>
    </button>
    <button class="extension-button ${extensionQuestions[sectionKey] ? "" : "hidden"}" type="button" aria-label="Open extension questions for ${card.title}">+</button>
    <button class="audio-button ${card.audioFile ? "" : "hidden"}" type="button" aria-label="Play audio for ${card.title}">></button>
    <button class="highlight-button" type="button" aria-label="Cycle highlight for ${card.title}">
      <span class="highlight-swatch" aria-hidden="true"></span>
    </button>
    <label class="mastery-toggle">
      <input class="mastery-input" type="checkbox" ${masteryState.has(sectionKey) ? "checked" : ""}>
      <span class="sr-only">Mark ${card.title} as mastered</span>
    </label>
  `;

  const flipTrigger = article.querySelector(".flip-trigger");
  const masteryInput = article.querySelector(".mastery-input");
  const extensionButton = article.querySelector(".extension-button");
  const audioButton = article.querySelector(".audio-button");
  const highlightButton = article.querySelector(".highlight-button");

  flipTrigger.addEventListener("click", () => {
    const isFlipped = article.classList.toggle("is-flipped");
    flipTrigger.setAttribute("aria-pressed", String(isFlipped));

    if (isFlipped && audioState[sectionKey]) {
      playSectionAudio(sectionKey);
    }
  });

  masteryInput.addEventListener("change", () => {
    article.classList.toggle("mastered", masteryInput.checked);
    if (masteryInput.checked) {
      masteryState.add(sectionKey);
    } else {
      masteryState.delete(sectionKey);
    }
    updateProgress();
  });

  extensionButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (extensionQuestions[sectionKey]) {
      openModal(sectionKey);
    }
  });

  highlightButton.addEventListener("click", (event) => {
    event.stopPropagation();
    cycleHighlightState(article, sectionKey);
  });

  if (card.audioFile) {
    const audio = new Audio(withAssetVersion(card.audioFile));
    audio.preload = "metadata";
    audio.addEventListener("play", () => updateAudioButton(sectionKey));
    audio.addEventListener("pause", () => updateAudioButton(sectionKey));
    audio.addEventListener("ended", () => updateAudioButton(sectionKey));
    audioState[sectionKey] = { audio, button: audioButton };
    updateAudioButton(sectionKey);
    audioButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (audio.paused) {
        playSectionAudio(sectionKey);
      } else {
        audio.pause();
        updateAudioButton(sectionKey);
      }
    });
  }

  if (masteryState.has(sectionKey)) {
    article.classList.add("mastered");
  }

  applyHighlightState(article, sectionKey);

  return article;
}

function createStaticCardElement(card) {
  const board = topicData.boards[activeBoardIndex];
  const bounds = getCardDisplayBounds(board, card);
  const article = document.createElement("article");
  article.className = "section-card static-display-card";
  article.style.setProperty("--x", bounds.x);
  article.style.setProperty("--y", bounds.y);
  article.style.setProperty("--w", bounds.w);
  article.style.setProperty("--h", bounds.h);
  article.innerHTML = `
    <div class="static-display-surface">
      <img class="static-display-image" src="${card.questionImage}" alt="${card.title}">
    </div>
  `;
  return article;
}

function updateProgress() {
  const total = getProgressTotal();
  const masteredCount = masteryState.size;
  const percent = total ? (masteredCount / total) * 100 : 0;
  progressText.textContent = `${masteredCount} / ${total} mastered`;
  progressFill.style.width = `${percent}%`;
  progressFill.classList.toggle("is-strong", percent > 50);
  publishProgress(total, masteredCount);
}

function applyHighlightState(article, sectionKey) {
  const mode = highlightState.get(sectionKey) || "";
  article.classList.toggle("is-highlight-yellow", mode === "yellow");
  article.classList.toggle("is-highlight-green", mode === "green");
}

function cycleHighlightState(article, sectionKey) {
  const currentMode = highlightState.get(sectionKey) || "";
  const nextMode = currentMode === "" ? "yellow" : currentMode === "yellow" ? "green" : "";

  if (nextMode) {
    highlightState.set(sectionKey, nextMode);
  } else {
    highlightState.delete(sectionKey);
  }

  applyHighlightState(article, sectionKey);
  publishProgress(getProgressTotal(), masteryState.size);
}

function parseExtensionMarkdown(markdown) {
  return markdown
    .split(/\n(?=\d+\.\s)/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const questionLine = lines.find((line) => /^\d+\.\s/.test(line)) || "";
      const answerIndex = lines.findIndex((line) => line.startsWith("Answer:"));
      const answerLines = answerIndex >= 0 ? lines.slice(answerIndex) : [];
      const answer = answerLines
        .map((line, index) => (index === 0 ? line.replace(/^Answer:\s*/, "") : line))
        .join("\n")
        .trim();

      return {
        question: questionLine.replace(/^\d+\.\s*/, "").trim(),
        answer
      };
    })
    .filter((item) => item.question && item.answer);
}

function modalKey(boardId, cardId) {
  return `${boardId}::${cardId}`;
}

function renderModalQuestion() {
  const sectionData = extensionQuestions[activeSectionKey];
  const questionData = sectionData.questions[activeQuestionIndex];
  const isLastQuestion = activeQuestionIndex === sectionData.questions.length - 1;

  modalTitle.textContent = sectionData.title;
  modalCounter.textContent = `Question ${activeQuestionIndex + 1} of ${sectionData.questions.length}`;
  modalQuestion.textContent = questionData.question;
  modalAnswer.textContent = questionData.answer;
  answerPanel.classList.add("hidden");
  revealAnswerButton.classList.remove("hidden");
  nextQuestionButton.textContent = isLastQuestion ? "Start over" : "Next";
}

function openModal(sectionKey) {
  activeSectionKey = sectionKey;
  activeQuestionIndex = 0;
  renderModalQuestion();
  updateModalViewport();
  extensionModal.classList.remove("hidden");
  requestAnimationFrame(updateModalViewport);
}

function closeModal() {
  extensionModal.classList.add("hidden");
  activeSectionKey = null;
  activeQuestionIndex = 0;
}

function updateAudioButton(sectionKey) {
  const state = audioState[sectionKey];
  if (!state) {
    return;
  }

  const { button, audio } = state;
  if (audio.ended && audio.currentTime > 0) {
    button.textContent = "R";
    button.classList.remove("is-playing");
    return;
  }

  if (!audio.paused) {
    button.textContent = "||";
    button.classList.add("is-playing");
    return;
  }

  button.textContent = ">";
  button.classList.remove("is-playing");
}

function pauseOtherAudios(activeKey) {
  Object.entries(audioState).forEach(([sectionKey, state]) => {
    if (sectionKey !== activeKey) {
      state.audio.pause();
      updateAudioButton(sectionKey);
    }
  });
}

function playSectionAudio(sectionKey) {
  const state = audioState[sectionKey];
  if (!state) {
    return;
  }

  pauseOtherAudios(sectionKey);

  if (state.audio.ended) {
    state.audio.currentTime = 0;
  }

  state.audio.play().catch(() => {
    updateAudioButton(sectionKey);
  });
  updateAudioButton(sectionKey);
}

async function loadExtensionQuestions(board) {
  const tasks = getBoardLayout(board).interactiveCards.map(async (card) => {
    if (!card.extensionFile) {
      return;
    }

    const key = modalKey(board.id, card.id);
    if (extensionQuestions[key]) {
      return;
    }

    let markdown = "";
    const fallbackMarkdown = window.__SUMMARY_EXTENSION_MARKDOWN__?.[card.extensionFile] || "";

    try {
      const response = await fetch(withAssetVersion(card.extensionFile));
      if (response.ok) {
        markdown = await response.text();
      }
    } catch (error) {
      markdown = fallbackMarkdown;
    }

    if (!markdown && fallbackMarkdown) {
      markdown = fallbackMarkdown;
    }

    const questions = parseExtensionMarkdown(markdown);
    if (!questions.length) {
      return;
    }

    extensionQuestions[key] = {
      title: card.title,
      questions
    };
  });

  await Promise.all(tasks);
}

async function loadTopicData() {
  try {
    const response = await fetch(`data/topic.json?v=${assetVersion}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (window.__SUMMARY_TOPIC_DATA__) {
      return window.__SUMMARY_TOPIC_DATA__;
    }
    throw error;
  }
}

function renderBoardTabs() {
  boardTabs.innerHTML = "";
  topicData.boards.forEach((board, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "board-tab" + (index === activeBoardIndex ? " is-active" : "");
    button.textContent = board.title || `Board ${index + 1}`;
    button.addEventListener("click", () => {
      activeBoardIndex = index;
      if (window.location.hash !== `#${board.id}`) {
        history.replaceState(null, "", `#${board.id}`);
      }
      renderBoardTabs();
      renderBoard();
    });
    boardTabs.appendChild(button);
  });
}

function getBoardDecorations(board, displayLayout) {
  if (!topicData || board.id !== "board-01") {
    return [];
  }

  const boundsFor = (id) => displayLayout.cardBounds.get(id);
  const makeHeader = (title, ids, options = {}) => {
    const bounds = ids.map(boundsFor).filter(Boolean);
    if (!bounds.length) {
      return null;
    }
    const left = Math.min(...bounds.map((item) => item.x));
    const top = Math.min(...bounds.map((item) => item.y));
    const right = Math.max(...bounds.map((item) => item.x + item.w));
    const headerHeight = options.height || 70;
    const headerGap = options.gap ?? 18;
    const headerTop = options.absoluteTop ?? Math.max(0, top - headerHeight - headerGap);
    const headerLeft = options.absoluteLeft ?? left;
    const headerWidth = options.absoluteWidth ?? (right - left);
    return {
      title,
      className: options.className || "",
      x: headerLeft / displayLayout.expandedWidth,
      y: headerTop / displayLayout.expandedHeight,
      w: headerWidth / displayLayout.expandedWidth,
      h: headerHeight / displayLayout.expandedHeight
    };
  };

  if (topicData.code === "13") {
    return [
      makeHeader("Group 2", [
        "trends-physical-properties",
        "trends-chemical-group-2-chemical-properties",
        "carbonates-thermal-stability"
      ]),
      makeHeader("Group 17", [
        "trends-physical-properties-2",
        "group-17-chemical-properties",
        "hx-thermal-stability"
      ])
    ].filter(Boolean);
  }

  if (topicData.code === "14") {
    const reactions = boundsFor("reactions");
    const why = boundsFor("why-electrophilic-substitution");
    const mechanism1 = boundsFor("mechanism");
    const mechanism2 = boundsFor("mechanism-2");
    const reactivity = boundsFor("1-reactivity");
    const directing = boundsFor("2-directing-effect");
    const mechanismBounds = [mechanism1, mechanism2].filter(Boolean);
    const rightBounds = [reactivity, directing].filter(Boolean);
    const mechanismLeft = mechanismBounds.length ? Math.min(...mechanismBounds.map((item) => item.x)) : 0;
    const mechanismTop = mechanismBounds.length ? Math.min(...mechanismBounds.map((item) => item.y)) : 0;
    const mechanismRight = mechanismBounds.length ? Math.max(...mechanismBounds.map((item) => item.x + item.w)) : 0;
    const rightLeft = rightBounds.length ? Math.min(...rightBounds.map((item) => item.x)) : 0;
    const rightTop = rightBounds.length ? Math.min(...rightBounds.map((item) => item.y)) : 0;
    const rightRight = rightBounds.length ? Math.max(...rightBounds.map((item) => item.x + item.w)) : 0;
    const headerHeight = 76;
    const headerGap = 17;
    return [
      why
        ? makeHeader("Why electrophilic substitution?", ["why-electrophilic-substitution"], {
            height: headerHeight
          })
        : null,
      mechanismBounds.length
        ? makeHeader("Mechanisms", ["mechanism", "mechanism-2"], {
            absoluteTop: Math.max(0, mechanismTop - headerHeight - headerGap),
            absoluteLeft: mechanismLeft,
            absoluteWidth: mechanismRight - mechanismLeft,
            height: headerHeight
          })
        : null,
      rightBounds.length
        ? makeHeader("Effects of substituents", ["1-reactivity", "2-directing-effect"], {
            absoluteTop: Math.max(0, rightTop - headerHeight - headerGap),
            absoluteLeft: rightLeft,
            absoluteWidth: rightRight - rightLeft,
            height: headerHeight
          })
        : null
    ].filter(Boolean);
  }

  if (topicData.code === "15") {
    return [
      makeHeader("pH", [
        "ph-of-solutions-1",
        "ph-of-solutions-2",
        "ph-of-solutions-3",
        "ph-of-solutions-4"
      ], {
        height: 70,
        gap: 17
      })
    ].filter(Boolean);
  }

  if (topicData.code === "16") {
    const mechanismSn1 = boundsFor("mechanism-sn1");
    const mechanismSn2 = boundsFor("mechanism-sn2");
    const mechanismBounds = [mechanismSn1, mechanismSn2].filter(Boolean);
    if (!mechanismBounds.length) {
      return [];
    }
    const mechanismLeft = Math.min(...mechanismBounds.map((item) => item.x));
    const mechanismTop = Math.min(...mechanismBounds.map((item) => item.y));
    const mechanismRight = Math.max(...mechanismBounds.map((item) => item.x + item.w));
    const headerHeight = 76;
    const headerGap = 17;
    return [
      makeHeader("Mechanisms", ["mechanism-sn1", "mechanism-sn2"], {
        absoluteTop: Math.max(0, mechanismTop - headerHeight - headerGap),
        absoluteLeft: mechanismLeft,
        absoluteWidth: mechanismRight - mechanismLeft,
        height: headerHeight
      })
    ].filter(Boolean);
  }

  return [];
}

function createBoardDecorationElement(decoration) {
  const element = document.createElement("div");
  element.className = ["board-section-banner", decoration.className].filter(Boolean).join(" ");
  element.textContent = decoration.title;
  element.style.setProperty("--x", decoration.x);
  element.style.setProperty("--y", decoration.y);
  element.style.setProperty("--w", decoration.w);
  element.style.setProperty("--h", decoration.h);
  return element;
}

function syncBoardFromHash() {
  const boardId = window.location.hash.replace(/^#/, "");
  if (!boardId) {
    return;
  }
  const index = topicData.boards.findIndex((board) => board.id === boardId);
  if (index >= 0) {
    activeBoardIndex = index;
  }
}

function renderBoard() {
  const board = topicData.boards[activeBoardIndex];
  const layout = getBoardLayout(board);
  const displayLayout = getBoardDisplayLayout(board);
  boardElement.innerHTML = "";
  boardElement.dataset.topic = topicData.code || "";
  boardElement.dataset.board = board.id || "";
  boardElement.classList.toggle("is-portrait", board.height > board.width);
  const staticWidth = getStaticBoardPixelWidth(board, displayLayout);
  const staticHeight = staticWidth * (displayLayout.expandedHeight / Math.max(1, displayLayout.expandedWidth));
  boardElement.style.setProperty("--static-board-width", `${staticWidth}px`);
  boardElement.style.setProperty("--static-board-height", `${staticHeight}px`);
  boardElement.style.aspectRatio = "";
  currentStaticBoardWidth = staticWidth;
  currentStaticBoardHeight = staticHeight;
  updateBoardZoomStageSize();

  getBoardDecorations(board, displayLayout).forEach((decoration) => {
    boardElement.appendChild(createBoardDecorationElement(decoration));
  });

  layout.staticParents.forEach(({ parent, children }) => {
    const contentBox = getStaticParentFrame(parent, children);
    const contentRelX = (contentBox.x - parent.questionBbox[0]) / parent.questionBbox[2];
    const contentRelY = (contentBox.y - parent.questionBbox[1]) / parent.questionBbox[3];
    const contentRelW = contentBox.w / parent.questionBbox[2];
    const contentRelH = contentBox.h / parent.questionBbox[3];
    const article = document.createElement("article");
    article.className = "section-card static-section";
    article.dataset.parentId = parent.id;
    const parentBounds = getCardDisplayBounds(board, parent);
    article.style.setProperty("--x", parentBounds.x);
    article.style.setProperty("--y", parentBounds.y);
    article.style.setProperty("--w", parentBounds.w);
    article.style.setProperty("--h", parentBounds.h);
    const masks = [
      ...children.map((child) => {
      const bounds = getGroupedSlotBounds(child, contentBox, parent, board);
      return `<div class="static-mask" style="--x:${bounds.x}; --y:${bounds.y}; --w:${bounds.w}; --h:${bounds.h};"></div>`;
      }),
      ...getGroupedExtraMasks(parent).map((bounds) => (
        `<div class="static-mask" style="--x:${bounds.x}; --y:${bounds.y}; --w:${bounds.w}; --h:${bounds.h};"></div>`
      ))
    ].join("");
    article.innerHTML = `
      <div class="static-surface">
        <img class="static-background" src="${withAssetVersion(parent.questionImage)}" alt="${parent.title} background">
        <div class="static-parent-header">${parent.title}</div>
        <div class="static-content" style="--x:${contentRelX}; --y:${contentRelY}; --w:${contentRelW}; --h:${contentRelH};">
          ${masks}
        </div>
      </div>
    `;
    const surface = article.querySelector(".static-content");
    children.forEach((child) => {
      surface.appendChild(createCardElement(child, board, { grouped: true, parent, contentBox }));
    });
    boardElement.appendChild(article);
  });

  layout.interactiveCards.forEach((card) => {
    if (layout.groupedChildIds.has(card.id)) {
      return;
    }
    boardElement.appendChild(createCardElement(card, board));
  });

  layout.staticStandaloneCards.forEach((card) => {
    boardElement.appendChild(createStaticCardElement(card));
  });
}

resetButton.addEventListener("click", () => {
  masteryState.clear();
  highlightState.clear();
  Object.values(audioState).forEach((state) => state.audio.pause());
  renderBoard();
  updateProgress();
});

revealAnswerButton.addEventListener("click", () => {
  answerPanel.classList.remove("hidden");
  revealAnswerButton.classList.add("hidden");
});

nextQuestionButton.addEventListener("click", () => {
  const sectionData = extensionQuestions[activeSectionKey];
  activeQuestionIndex = (activeQuestionIndex + 1) % sectionData.questions.length;
  renderModalQuestion();
});

closeModalButton.addEventListener("click", closeModal);

extensionModal.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeModal === "true") {
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !extensionModal.classList.contains("hidden")) {
    closeModal();
  }
});

window.addEventListener("resize", updateModalViewport);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateModalViewport);
  window.visualViewport.addEventListener("scroll", updateModalViewport);
}

async function init() {
  topicData = await loadTopicData();
  document.title = `${topicData.title} Summary Map`;
  document.getElementById("topicTitle").textContent = topicData.title;
  loadStoredProgress();
  loadStoredBoardZoom();
  syncBoardFromHash();
  await Promise.all(topicData.boards.map((board) => loadExtensionQuestions(board)));
  renderBoardTabs();
  createBoardZoomControls();
  renderBoard();
  updateProgress();
}

init().catch((error) => {
  boardElement.innerHTML = `<p class="board-label">Failed to load topic data: ${error.message}</p>`;
});
