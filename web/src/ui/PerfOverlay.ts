import type { Application } from "pixi.js";

/**
 * A small frame-time readout for diagnosing "it feels laggy".
 *
 * Toggled with the backtick key or F8, or shown from the start with `?perf` in
 * the page URL (for keyboards without a backtick). It samples the Pixi ticker every frame and
 * shows, over the last two seconds: frames per second, median and 95th
 * percentile frame interval, the worst frame, plus the GPU the browser
 * reports and the device pixel ratio. The GPU line is the one to read first:
 * a "SwiftShader" or "llvmpipe" renderer means the browser fell back to
 * software rendering and nothing in the client can make that fast.
 */
export class PerfOverlay {
  private readonly element: HTMLElement;
  private readonly samples: number[] = [];
  private visible = false;
  private sinceText = 0;
  private gpu = "unknown";

  constructor(
    private readonly pixi: Application,
    host: HTMLElement,
  ) {
    this.element = document.createElement("pre");
    this.element.className = "perf-overlay";
    this.element.hidden = true;
    this.element.setAttribute("aria-live", "off");
    host.append(this.element);

    this.gpu = readGpuName(pixi.canvas);
    if (new URLSearchParams(window.location.search).has("perf")) this.setVisible(true);
    window.addEventListener("keydown", this.onKey);
    pixi.ticker.add(this.onTick);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.pixi.ticker.remove(this.onTick);
    this.element.remove();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const isToggle = event.key === "F8" || event.key === "`";
    if (!isToggle) return;
    const target = event.target as HTMLElement | null;
    if (event.key === "`" && target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    event.preventDefault();
    this.setVisible(!this.visible);
  };

  private setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.hidden = !visible;
    this.samples.length = 0;
  }

  private readonly onTick = (): void => {
    if (!this.visible) return;
    const ms = this.pixi.ticker.elapsedMS;
    this.samples.push(ms);
    // Two seconds of history at 144 Hz.
    if (this.samples.length > 300) this.samples.shift();

    this.sinceText += ms;
    if (this.sinceText < 250) return;
    this.sinceText = 0;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    const mean = sorted.reduce((sum, value) => sum + value, 0) / Math.max(sorted.length, 1);
    const worst = sorted[sorted.length - 1] ?? 0;
    const over = sorted.filter((value) => value > 33).length;

    this.element.textContent =
      `${(1000 / mean).toFixed(0)} fps   frame p50 ${at(0.5).toFixed(1)} ms   ` +
      `p95 ${at(0.95).toFixed(1)} ms   worst ${worst.toFixed(1)} ms   ` +
      `>33 ms: ${over}\n` +
      `gpu ${this.gpu}\n` +
      `dpr ${window.devicePixelRatio}   canvas ${this.pixi.canvas.width}x${this.pixi.canvas.height}   ` +
      `${navigator.userAgent.includes("Firefox") ? "firefox" : "chromium/other"}` +
      dragLine();
  };
}

/** The GPU the browser exposes to WebGL, or a note when it hides it. */
const readGpuName = (canvas: HTMLCanvasElement): string => {
  try {
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return "no webgl context";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (!info) return "hidden by browser";
    return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  } catch {
    return "unreadable";
  }
};

/** Last drag: how many frames the camera actually moved on, if a camera is attached. */
const dragLine = (): string => {
  const camera = (globalThis as { __bymrCamera?: { dragStats: { frames: number; moved: number } } })
    .__bymrCamera;
  if (!camera || camera.dragStats.frames === 0) return "";
  const { frames, moved } = camera.dragStats;
  return `\nlast drag: moved on ${moved} of ${frames} frames`;
};
