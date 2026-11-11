// Draws the revenue and expenses trend from the figures embedded in the page.
(function () {
  const chart = document.querySelector("[data-trend-chart]");
  const { monthly } = JSON.parse(document.getElementById("dashboard-page-data").textContent);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MARGIN = { top: 12, right: 62, bottom: 24, left: 44 };
  const MIN_LABEL_GAP = 14;
  const SERIES = [
    { key: "revenue", label: "Revenue", color: "var(--chart-1)" },
    { key: "expense", label: "Expenses", color: "var(--chart-2)" }
  ];
  const money = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 });

  const viewButtons = [...document.querySelectorAll("[data-view]")];
  const viewPanels = [...document.querySelectorAll("[data-view-panel]")];
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      viewButtons.forEach((other) => {
        other.classList.toggle("active", other === button);
        other.setAttribute("aria-pressed", String(other === button));
      });
      viewPanels.forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== button.dataset.view; });
    });
  });

  if (!monthly.some((m) => m.revenue !== 0 || m.expense !== 0)) {
    chart.innerHTML = '<p class="chart-empty">No revenue or expenses posted in this fiscal year yet</p>';
    return;
  }

  function svgEl(name, attributes, parent) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    parent.appendChild(element);
    return element;
  }

  // A round step gives axis ticks that can be read at a glance.
  function roundStep(span, count) {
    const raw = span / count;
    const power = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / power;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  }

  // Monotone cubic: smooth like a spline, but it never overshoots the actual monthly figures.
  function curvePath(points) {
    const n = points.length;
    if (n < 3) return points.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ");
    const slopes = points.slice(1).map(([px, py], i) => (py - points[i][1]) / (px - points[i][0]));
    const tangents = points.map((_, i) => {
      if (i === 0) return slopes[0];
      if (i === n - 1) return slopes[n - 2];
      return slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
    });
    slopes.forEach((slope, i) => {
      if (slope === 0) {
        tangents[i] = 0;
        tangents[i + 1] = 0;
        return;
      }
      const a = tangents[i] / slope;
      const b = tangents[i + 1] / slope;
      const size = a * a + b * b;
      if (size > 9) {
        const scale = 3 / Math.sqrt(size);
        tangents[i] = scale * a * slope;
        tangents[i + 1] = scale * b * slope;
      }
    });
    let path = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < n - 1; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const h = (x1 - x0) / 3;
      path += ` C${x0 + h} ${y0 + tangents[i] * h} ${x1 - h} ${y1 - tangents[i + 1] * h} ${x1} ${y1}`;
    }
    return path;
  }

  function draw() {
    chart.replaceChildren();
    const width = chart.clientWidth;
    const height = chart.clientHeight;
    if (!width || !height) return;

    const values = monthly.flatMap((m) => [m.revenue, m.expense]);
    const low = Math.min(0, ...values);
    const high = Math.max(0, ...values);
    const step = roundStep(high - low, 4);
    const yMin = Math.floor(low / step) * step;
    const yMax = Math.ceil(high / step) * step;
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const x = (i) => MARGIN.left + (monthly.length === 1 ? plotWidth / 2 : (i * plotWidth) / (monthly.length - 1));
    const y = (value) => MARGIN.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

    const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" }, chart);
    const gradient = svgEl("linearGradient", { id: "trend-area", x1: 0, y1: 0, x2: 0, y2: 1 }, svgEl("defs", {}, svg));
    svgEl("stop", { offset: "0%", "stop-color": "var(--chart-1)", "stop-opacity": 0.14 }, gradient);
    svgEl("stop", { offset: "100%", "stop-color": "var(--chart-1)", "stop-opacity": 0 }, gradient);

    for (let value = yMin; value <= yMax + step / 2; value += step) {
      svgEl("line", {
        x1: MARGIN.left, x2: width - MARGIN.right, y1: y(value), y2: y(value),
        stroke: "var(--line)", "stroke-width": 1
      }, svg);
      svgEl("text", {
        x: MARGIN.left - 10, y: y(value) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)"
      }, svg).textContent = compact.format(value);
    }

    const labelEvery = Math.max(1, Math.ceil((monthly.length * 34) / plotWidth));
    monthly.forEach((m, i) => {
      if (i % labelEvery !== 0) return;
      svgEl("text", {
        x: x(i), y: height - 4, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)"
      }, svg).textContent = m.short;
    });

    const pointsFor = (key) => monthly.map((m, i) => [x(i), y(m[key])]);
    if (monthly.length > 1) {
      const floor = y(Math.max(yMin, 0));
      svgEl("path", {
        d: `${curvePath(pointsFor("revenue"))} L${x(monthly.length - 1)} ${floor} L${x(0)} ${floor} Z`,
        fill: "url(#trend-area)"
      }, svg);
    }
    SERIES.forEach(({ key, color }) => {
      if (monthly.length > 1) {
        svgEl("path", {
          d: curvePath(pointsFor(key)), fill: "none", stroke: color, "stroke-width": 2,
          "stroke-linejoin": "round", "stroke-linecap": "round"
        }, svg);
      } else {
        svgEl("circle", { cx: x(0), cy: y(monthly[0][key]), r: 4, fill: color }, svg);
      }
    });

    // Direct labels at the line ends; the lower one moves down when the two would touch.
    const lastIndex = monthly.length - 1;
    const ends = SERIES.map((s) => ({ ...s, y: y(monthly[lastIndex][s.key]) })).sort((a, b) => a.y - b.y);
    if (ends[1].y - ends[0].y < MIN_LABEL_GAP) ends[1].y = ends[0].y + MIN_LABEL_GAP;
    ends.forEach((end) => {
      svgEl("text", {
        x: x(lastIndex) + 8, y: end.y + 4, "font-size": 11, "font-weight": 500, fill: "var(--ink-soft)"
      }, svg).textContent = end.label;
    });

    const crosshair = svgEl("line", {
      y1: MARGIN.top, y2: MARGIN.top + plotHeight, stroke: "var(--line-strong)", "stroke-width": 1, visibility: "hidden"
    }, svg);
    const dots = SERIES.map(({ color }) => svgEl("circle", {
      r: 4, fill: color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden"
    }, svg));
    const hitArea = svgEl("rect", {
      x: MARGIN.left - 12, y: 0, width: plotWidth + 24, height, fill: "transparent"
    }, svg);

    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    chart.appendChild(tooltip);

    hitArea.addEventListener("pointermove", (event) => {
      const offset = event.clientX - svg.getBoundingClientRect().left - MARGIN.left;
      const ratio = Math.min(1, Math.max(0, offset / plotWidth));
      const index = Math.round(ratio * lastIndex);
      const month = monthly[index];
      crosshair.setAttribute("x1", x(index));
      crosshair.setAttribute("x2", x(index));
      crosshair.setAttribute("visibility", "visible");
      dots.forEach((dot, i) => {
        dot.setAttribute("cx", x(index));
        dot.setAttribute("cy", y(month[SERIES[i].key]));
        dot.setAttribute("visibility", "visible");
      });
      tooltip.innerHTML = `<strong>${month.label}</strong>${SERIES.map(
        (s, i) => `<div><i class="swatch slot-${i + 1}"></i>${s.label}<b>${money.format(month[s.key])}</b></div>`
      ).join("")}`;
      tooltip.hidden = false;
      const room = x(index) + 12 + tooltip.offsetWidth <= width;
      tooltip.style.left = `${room ? x(index) + 12 : x(index) - tooltip.offsetWidth - 12}px`;
    });
    hitArea.addEventListener("pointerleave", () => {
      crosshair.setAttribute("visibility", "hidden");
      dots.forEach((dot) => dot.setAttribute("visibility", "hidden"));
      tooltip.hidden = true;
    });
  }

  new ResizeObserver(draw).observe(chart);
})();
