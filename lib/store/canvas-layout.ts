import { useEditorStore, useImageStore } from './index';

/** Layout uses preview pixels: keep the document and every undo snapshot in the same space. */
export function rebaseCanvasGeometry(sx: number, sy: number) {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return;
  const scaleOverlays = (overlays: ReturnType<typeof useImageStore.getState>['imageOverlays']) => overlays.map(o => ({
    ...o,
    position: { x: o.position.x * sx, y: o.position.y * sy },
    size: o.size * Math.min(sx, sy),
  }));
  const history = useImageStore.temporal.getState();
  const scalePlacement = (p: ReturnType<typeof useImageStore.getState>['mainImagePlacement']) => p && ({ ...p, offsetX: p.offsetX * sx, offsetY: p.offsetY * sy });
  const tracking = history.isTracking;
  if (tracking) history.pause();
  try {
    useImageStore.setState(s => ({ imageOverlays: scaleOverlays(s.imageOverlays) }));
    useImageStore.temporal.setState({
      pastStates: history.pastStates.map(s => ({ ...s, ...(s.imageOverlays ? { imageOverlays: scaleOverlays(s.imageOverlays) } : {}), ...(s.mainImagePlacement ? { mainImagePlacement: scalePlacement(s.mainImagePlacement) } : {}) })),
      futureStates: history.futureStates.map(s => ({ ...s, ...(s.imageOverlays ? { imageOverlays: scaleOverlays(s.imageOverlays) } : {}), ...(s.mainImagePlacement ? { mainImagePlacement: scalePlacement(s.mainImagePlacement) } : {}) })),
    });
    const screenshot = useEditorStore.getState().screenshot;
    useEditorStore.getState().setScreenshot({ offsetX: screenshot.offsetX * sx, offsetY: screenshot.offsetY * sy });
  } finally {
    if (tracking) history.resume();
  }
}
