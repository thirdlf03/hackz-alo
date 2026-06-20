import { monoFont } from "../render/gamePalette.js";

const monitorContentWidth = 496;
const monitorContentHeight = 540;
const expandedMonitorWidth = 1400;
const expandedMonitorHeight = 780;
export const terminalLineHeight = 22;
const terminalFontSize = 18;

export function measureTerminalCellWidth() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 11;
  ctx.font = monoFont(terminalFontSize);
  return Math.max(8, ctx.measureText("M").width);
}

export function terminalDimensionsForContent(contentWidth: number, contentHeight: number) {
  const cellWidth = measureTerminalCellWidth();
  return {
    cols: Math.max(12, Math.floor(contentWidth / cellWidth)),
    rows: Math.max(10, Math.floor(contentHeight / terminalLineHeight))
  };
}

export function defaultTerminalDimensions() {
  return terminalDimensionsForContent(monitorContentWidth, monitorContentHeight);
}

export function expandedTerminalDimensions() {
  const contentWidth = expandedMonitorWidth - 44;
  const contentHeight = expandedMonitorHeight - 80;
  const scale = Math.min(contentWidth / monitorContentWidth, contentHeight / monitorContentHeight);
  return terminalDimensionsForContent(contentWidth / scale, contentHeight / scale);
}
