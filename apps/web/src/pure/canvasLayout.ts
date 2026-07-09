export const logicalWidth = 1920;
export const logicalHeight = 1080;
export const monitorContentWidth = 496;
export const monitorContentHeight = 540;
export const terminalContentWidth = 496;
/** Upper slice of the metrics monitor reserved for the service topology map. */
export const TOPOLOGY_MAP_HEIGHT = 240;

const runbookContentX = 1332;
const runbookContentY = 204;

export const RUNBOOK_TAB_GAP = 8;
export const RUNBOOK_TAB_PAD_X = 16;
const RUNBOOK_TAB_MIN_WIDTH = 132;
const RUNBOOK_TAB_MAX_WIDTH = 240;
const RUNBOOK_TAB_HIT_PAD = 8;
const RUNBOOK_CONTENT_GAP = 28;

export const RIGHT_PANEL_PRIMARY_TABS = [
  {id: 'runbook' as const, label: 'Runbook', width: 108},
  {id: 'chat' as const, label: 'チャット', width: 88},
];
export const RIGHT_PANEL_PRIMARY_TAB_HEIGHT = 40;
export const RIGHT_PANEL_SECONDARY_TAB_HEIGHT = 40;
const RIGHT_PANEL_TAB_ROW_GAP = 8;
const RIGHT_PANEL_COMPOSE_HEIGHT = 44;
const RIGHT_PANEL_COMPOSE_PADDING = 16;
const CENTER_TOOL_TAB_WIDTH = 118;
const CENTER_TOOL_TAB_HEIGHT = 34;
const CENTER_TOOL_TAB_GAP = 8;
export const METRICS_SCROLL_TOP = 56;

export type RightPanelTab = 'runbook' | 'chat';
export type MonitorId = 'metrics' | 'terminal' | 'runbook';

export function rightPanelLayout(
  activeTab: RightPanelTab,
  hasRunbooks: boolean
) {
  const primaryTop = 0;
  const secondaryTop =
    primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + RIGHT_PANEL_TAB_ROW_GAP;
  const runbookContentTop = hasRunbooks
    ? secondaryTop + RIGHT_PANEL_SECONDARY_TAB_HEIGHT + RUNBOOK_CONTENT_GAP
    : primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + RUNBOOK_CONTENT_GAP;
  const chatMessagesTop =
    primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + RUNBOOK_CONTENT_GAP;
  const composeTop =
    monitorContentHeight -
    RIGHT_PANEL_COMPOSE_HEIGHT -
    RIGHT_PANEL_COMPOSE_PADDING;

  return {
    primaryTop,
    secondaryTop,
    contentTop: activeTab === 'runbook' ? runbookContentTop : chatMessagesTop,
    composeTop,
    chatMessagesTop,
    chatMessagesBottom: composeTop - 12,
  };
}

function runbookTabMeasureTextWidth(text: string) {
  return text.length * 16;
}

export function measureRunbookTabWidth(
  title: string,
  measure?: (text: string) => number
) {
  const width = (measure ?? runbookTabMeasureTextWidth)(title);
  return Math.max(
    RUNBOOK_TAB_MIN_WIDTH,
    Math.min(RUNBOOK_TAB_MAX_WIDTH, width + RUNBOOK_TAB_PAD_X * 2)
  );
}

export const monitorLayouts = [
  {
    id: 'metrics' as const,
    x: 70,
    y: 140,
    width: 540,
    height: 620,
    title: 'METRICS',
  },
  {
    id: 'terminal' as const,
    x: 690,
    y: 140,
    width: 540,
    height: 620,
    title: 'TERMINAL',
  },
  {
    id: 'runbook' as const,
    x: 1310,
    y: 140,
    width: 540,
    height: 620,
    title: 'RUNBOOK / チャット',
  },
] as const;

type MonitorLayoutId = (typeof monitorLayouts)[number]['id'];

const monitorLayoutMap = Object.fromEntries(
  monitorLayouts.map((item) => [item.id, item])
) as Record<MonitorLayoutId, (typeof monitorLayouts)[number]>;

export function monitorLayout(id: MonitorLayoutId) {
  return monitorLayoutMap[id];
}

export const expandedMonitorLayout = {
  x: 260,
  y: 50,
  width: 1400,
  height: 780,
} as const;

export function monitorContentRegion(monitor: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: monitor.x + 22,
    y: monitor.y + 64,
    width: monitor.width - 44,
    height: monitor.height - 80,
  };
}

function runbookContentTransform(expandedRunbook: boolean) {
  const monitor = monitorLayout('runbook');
  const frameX = expandedRunbook ? expandedMonitorLayout.x : monitor.x;
  const frameY = expandedRunbook ? expandedMonitorLayout.y : monitor.y;
  const frameWidth = expandedRunbook
    ? expandedMonitorLayout.width
    : monitor.width;
  const frameHeight = expandedRunbook
    ? expandedMonitorLayout.height
    : monitor.height;
  const contentWidth = frameWidth - 44;
  const contentHeight = frameHeight - 80;
  const scale = Math.min(
    contentWidth / monitorContentWidth,
    contentHeight / monitorContentHeight
  );
  return {
    x: frameX + 22,
    y: frameY + 64,
    scale,
  };
}

export const monitorMagnifyRegions = monitorLayouts.map((monitor) => ({
  id: monitor.id,
  x: monitor.x + monitor.width - 50,
  y: monitor.y + 4,
  width: 44,
  height: 44,
}));

export const notificationBellRegion = {
  x: 1508,
  y: 34,
  width: 52,
  height: 52,
} as const;

export const notificationPanelRegion = {
  x: 1188,
  y: 92,
  width: 372,
  height: 420,
} as const;

export const inputDockRects = {
  input: {x: 70, y: 878, width: 1280, height: 96},
  retire: {x: 1370, y: 878, width: 140, height: 96},
  button: {x: 1530, y: 878, width: 160, height: 96},
} as const;

export const navigationOverlayRect = {
  x: 720,
  y: 860,
  width: 480,
  height: 120,
} as const;

export function centerToolTabRegions() {
  const monitor = monitorLayout('terminal');
  const y = monitor.y + 10;
  const firstX = monitor.x + 22;
  return [
    {
      id: 'terminal' as const,
      label: 'TERMINAL',
      x: firstX,
      y,
      width: CENTER_TOOL_TAB_WIDTH,
      height: CENTER_TOOL_TAB_HEIGHT,
    },
    {
      id: 'editor' as const,
      label: 'EDITOR',
      x: firstX + CENTER_TOOL_TAB_WIDTH + CENTER_TOOL_TAB_GAP,
      y,
      width: CENTER_TOOL_TAB_WIDTH,
      height: CENTER_TOOL_TAB_HEIGHT,
    },
  ];
}

export function centerToolAt(
  x: number,
  y: number
): 'terminal' | 'editor' | null {
  for (const tab of centerToolTabRegions()) {
    if (containsCanvasPoint(tab, x, y)) return tab.id;
  }
  return null;
}

export function centerEditorOverlayRegion(expanded = false) {
  const monitor = expanded ? expandedMonitorLayout : monitorLayout('terminal');
  const content = monitorContentRegion(monitor);
  const scale = Math.min(
    content.width / monitorContentWidth,
    content.height / monitorContentHeight
  );
  const editorX = 156;
  const editorY = 66;
  return {
    x: content.x + editorX * scale,
    y: content.y + editorY * scale,
    width: (content.width / scale - editorX) * scale,
    height: 470 * scale,
  };
}

export function metricsPanelScrollRegion(expanded = false) {
  const monitor = expanded ? expandedMonitorLayout : monitorLayout('metrics');
  const content = monitorContentRegion(monitor);
  const scale = Math.min(
    content.width / monitorContentWidth,
    content.height / monitorContentHeight
  );
  return {
    x: content.x,
    y: content.y + METRICS_SCROLL_TOP * scale,
    width: content.width,
    height: Math.max(0, content.height - METRICS_SCROLL_TOP * scale),
  };
}

export const runbookTabRegion = () => {
  const layout = rightPanelLayout('runbook', true);
  return {
    x: runbookContentX,
    y: runbookContentY + layout.secondaryTop - RUNBOOK_TAB_HIT_PAD,
    width: 516,
    height: RIGHT_PANEL_SECONDARY_TAB_HEIGHT + RUNBOOK_TAB_HIT_PAD * 2,
  };
};

function chatComposeScreenRegion(
  activePanelTab: RightPanelTab,
  expandedMonitor: MonitorId | null | undefined
) {
  if (activePanelTab !== 'chat') return null;
  const layout = rightPanelLayout('chat', false);
  const content = runbookContentTransform(expandedMonitor === 'runbook');
  return {
    x: content.x,
    y: content.y + layout.composeTop * content.scale,
    width: 470 * content.scale,
    height: RIGHT_PANEL_COMPOSE_HEIGHT * content.scale,
  };
}

export const chatComposeRegion = (
  activePanelTab: RightPanelTab = 'chat',
  expandedMonitor: MonitorId | null = null
) =>
  chatComposeScreenRegion(activePanelTab, expandedMonitor) ?? {
    x: 0,
    y: -1000,
    width: 0,
    height: 0,
  };

export const chatSendButtonRegion = (
  activePanelTab: RightPanelTab = 'chat',
  expandedMonitor: MonitorId | null = null
) => {
  const compose = chatComposeScreenRegion(activePanelTab, expandedMonitor);
  if (!compose) return {x: 0, y: -1000, width: 0, height: 0};
  return {
    x: compose.x + (404 * compose.width) / 470,
    y: compose.y + (8 * compose.height) / RIGHT_PANEL_COMPOSE_HEIGHT,
    width: (56 * compose.width) / 470,
    height: (28 * compose.height) / RIGHT_PANEL_COMPOSE_HEIGHT,
  };
};

export function monitorMagnifyAt(x: number, y: number): MonitorId | null {
  for (const region of monitorMagnifyRegions) {
    if (containsCanvasPoint(region, x, y)) return region.id;
  }
  return null;
}

export function chatComposeAt(
  x: number,
  y: number,
  activePanelTab: RightPanelTab = 'chat',
  expandedMonitor: MonitorId | null = null
) {
  const composeRegion = chatComposeScreenRegion(
    activePanelTab,
    expandedMonitor
  );
  if (!composeRegion || !containsCanvasPoint(composeRegion, x, y)) return null;
  const sendRegion = chatSendButtonRegion(activePanelTab, expandedMonitor);
  if (containsCanvasPoint(sendRegion, x, y)) return 'send' as const;
  return 'compose' as const;
}

export function rightPanelPrimaryTabAt(
  x: number,
  y: number,
  expandedMonitor?: MonitorId | null
): RightPanelTab | null {
  if (expandedMonitor && expandedMonitor !== 'runbook') return null;

  const layout = rightPanelLayout('runbook', true);
  const content = runbookContentTransform(expandedMonitor === 'runbook');
  const localY = (y - content.y) / content.scale;
  if (
    localY < layout.primaryTop - RUNBOOK_TAB_HIT_PAD ||
    localY >
      layout.primaryTop + RIGHT_PANEL_PRIMARY_TAB_HEIGHT + RUNBOOK_TAB_HIT_PAD
  ) {
    return null;
  }

  let tabX = 0;
  for (const tab of RIGHT_PANEL_PRIMARY_TABS) {
    const hitLeft =
      content.x + tabX * content.scale - RUNBOOK_TAB_HIT_PAD * content.scale;
    const hitWidth = (tab.width + RUNBOOK_TAB_HIT_PAD * 2) * content.scale;
    if (x >= hitLeft && x <= hitLeft + hitWidth) return tab.id;
    tabX += tab.width + RUNBOOK_TAB_GAP;
  }
  return null;
}

export function runbookTabAt(
  x: number,
  y: number,
  runbookCount: number,
  titles: string[],
  expandedMonitor?: MonitorId | null,
  activePanelTab: RightPanelTab = 'runbook'
) {
  if (runbookCount === 0 || activePanelTab !== 'runbook') return -1;
  if (expandedMonitor && expandedMonitor !== 'runbook') return -1;

  const layout = rightPanelLayout('runbook', true);
  const content = runbookContentTransform(expandedMonitor === 'runbook');
  const localY = (y - content.y) / content.scale;
  if (
    localY < layout.secondaryTop - RUNBOOK_TAB_HIT_PAD ||
    localY >
      layout.secondaryTop +
        RIGHT_PANEL_SECONDARY_TAB_HEIGHT +
        RUNBOOK_TAB_HIT_PAD
  ) {
    return -1;
  }

  let tabX = 0;
  for (let index = 0; index < runbookCount; index += 1) {
    const width = measureRunbookTabWidth(titles[index] ?? '');
    const hitLeft =
      content.x + tabX * content.scale - RUNBOOK_TAB_HIT_PAD * content.scale;
    const hitWidth = (width + RUNBOOK_TAB_HIT_PAD * 2) * content.scale;
    if (x >= hitLeft && x <= hitLeft + hitWidth) return index;
    tabX += width + RUNBOOK_TAB_GAP;
  }
  return -1;
}

export function containsCanvasPoint(
  rect: {x: number; y: number; width: number; height: number},
  x: number,
  y: number
) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}
