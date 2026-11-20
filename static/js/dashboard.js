let mainChart = null;
let readingsCache = [];

document.addEventListener("DOMContentLoaded", () => {
    initCharts();
    refreshAllData();
    connectSSE();

    const filter = document.getElementById("deviceFilter");
    if (filter) {
        filter.addEventListener("change", () => {
            refreshAllData();
        });
    }
});

function createAreaGradient(ctx, colorTop, colorBottom) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, colorTop);
    gradient.addColorStop(1, colorBottom);
    return gradient;
}

/**
 * Suaviza series de telemetría atenuando picos transitorios y ruido de alta frecuencia
 * mediante un filtro gaussiano ponderado simétrico (sin retraso de fase).
 */
function smoothSeries(data, radius = 2) {
    if (!Array.isArray(data) || data.length < 3) return data ? [...data] : [];

    // 1. Atenuar picos transitorios aislados (outliers del sensor)
    const despiked = [...data];
    for (let i = 1; i < despiked.length - 1; i++) {
        const prev = despiked[i - 1];
        const curr = despiked[i];
        const next = despiked[i + 1];
        if (typeof curr === "number" && typeof prev === "number" && typeof next === "number") {
            const d1 = curr - prev;
            const d2 = curr - next;
            if (d1 * d2 > 0) {
                const avgNeighbor = (prev + next) / 2;
                const diff = Math.abs(curr - avgNeighbor);
                if (diff > 1.0) {
                    despiked[i] = avgNeighbor + (curr - avgNeighbor) * 0.25;
                }
            }
        }
    }

    // 2. Filtro de media móvil ponderada gaussiana (kernel simétrico [1, 3, 5, 3, 1])
    const weights = radius === 2 ? [1, 3, 5, 3, 1] : [1, 2, 1];
    const half = Math.floor(weights.length / 2);
    const result = [];

    for (let i = 0; i < despiked.length; i++) {
        let weightedSum = 0;
        let totalWeight = 0;

        for (let w = -half; w <= half; w++) {
            const idx = i + w;
            if (idx >= 0 && idx < despiked.length) {
                const val = despiked[idx];
                if (typeof val === "number" && !isNaN(val)) {
                    const weight = weights[w + half];
                    weightedSum += val * weight;
                    totalWeight += weight;
                }
            }
        }

        const smoothedVal = totalWeight > 0 ? weightedSum / totalWeight : despiked[i];
        result.push(Number(smoothedVal.toFixed(2)));
    }

    return result;
}

function initCharts() {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js no disponible.");
        return;
    }

    const isMobile = window.innerWidth <= 640;
    Chart.defaults.color = "#64748b";
    Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
    Chart.defaults.font.size = isMobile ? 10 : 11;

    const ctx1 = document.getElementById("mainTelemetryChart").getContext("2d");
    mainChart = new Chart(ctx1, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Temp (°C)",
                    data: [],
                    borderColor: "#f97316",
                    backgroundColor: createAreaGradient(ctx1, "rgba(249, 115, 22, 0.22)", "rgba(249, 115, 22, 0.0)"),
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 14,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: "#f97316",
                    cubicInterpolationMode: "monotone",
                    tension: 0.45,
                    fill: true,
                    yAxisID: "yTemp",
                },
                {
                    label: "Humedad (%)",
                    data: [],
                    borderColor: "#38bdf8",
                    backgroundColor: createAreaGradient(ctx1, "rgba(56, 189, 248, 0.18)", "rgba(56, 189, 248, 0.0)"),
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 14,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: "#38bdf8",
                    cubicInterpolationMode: "monotone",
                    tension: 0.45,
                    fill: true,
                    yAxisID: "yHum",
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 420,
                easing: "easeOutQuart",
            },
            interaction: {
                mode: "index",
                intersect: false,
            },
            plugins: {
                legend: {
                    position: "top",
                    align: "end",
                    labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 6, padding: 14 },
                },
                tooltip: {
                    backgroundColor: "rgba(15, 23, 42, 0.94)",
                    titleColor: "#f8fafc",
                    bodyColor: "#94a3b8",
                    borderColor: "rgba(148, 163, 184, 0.18)",
                    borderWidth: 1,
                    padding: 8,
                    cornerRadius: 8,
                    usePointStyle: true,
                    callbacks: {
                        label: function (context) {
                            const label = context.dataset.label || "";
                            const val = context.parsed.y;
                            const rawArr = context.dataset.rawValues;
                            const raw = rawArr && rawArr[context.dataIndex] !== undefined ? rawArr[context.dataIndex] : val;
                            if (Math.abs(val - raw) >= 0.2) {
                                return ` ${label}: ${Number(val).toFixed(1)} (medido: ${raw})`;
                            }
                            return ` ${label}: ${Number(val).toFixed(1)}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    border: { display: false },
                    grid: { color: "rgba(148, 163, 184, 0.06)" },
                    ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: isMobile ? 5 : 8 },
                },
                yTemp: {
                    type: "linear",
                    display: true,
                    position: "left",
                    border: { display: false },
                    grace: "12%",
                    grid: { color: "rgba(148, 163, 184, 0.06)" },
                    ticks: { color: "#f97316" },
                },
                yHum: {
                    type: "linear",
                    display: true,
                    position: "right",
                    border: { display: false },
                    grace: "12%",
                    grid: { drawOnChartArea: false },
                    ticks: { color: "#38bdf8" },
                },
            },
        },
    });
}

async function refreshAllData() {
    const filterEl = document.getElementById("deviceFilter");
    const device = filterEl ? filterEl.value : "ALL";
    const limitEl = document.getElementById("sampleLimit");
    const limit = limitEl ? parseInt(limitEl.value, 10) || 50 : 50;

    try {
        const [readingsRes, statsRes] = await Promise.all([
            fetch(`/api/readings?limit=${limit}&device_id=${encodeURIComponent(device)}`),
            fetch(`/api/stats?device_id=${encodeURIComponent(device)}`),
        ]);
        const readingsData = await readingsRes.json();
        const statsData = await statsRes.json();

        if (readingsData.ok) {
            readingsCache = readingsData.readings || [];
            renderChartsAndTable();
        }
        if (statsData.ok) {
            updateStatsUI(statsData);
        }
    } catch (err) {
        console.error("Error consultando API:", err);
    }
}

function updateStatsUI(statsData) {
    const { summary, latest, devices } = statsData;

    const select = document.getElementById("deviceFilter");
    if (select) {
        const currentSelection = select.value;
        const knownDevices = new Set(["ALL"]);
        if (devices) {
            devices.forEach((d) => knownDevices.add(d.device_id));
        }
        select.innerHTML = "";
        knownDevices.forEach((devId) => {
            const opt = document.createElement("option");
            opt.value = devId;
            opt.textContent = devId === "ALL" ? "Todos los nodos" : devId;
            if (devId === currentSelection) opt.selected = true;
            select.appendChild(opt);
        });
    }

    if (summary && summary.total_packets > 0 && latest) {
        document.getElementById("valPackets").textContent = summary.total_packets;
        document.getElementById("minTemp").textContent = summary.min_temp ?? "--";
        document.getElementById("avgTemp").textContent = summary.avg_temp ?? "--";
        document.getElementById("maxTemp").textContent = summary.max_temp ?? "--";

        document.getElementById("minHum").textContent = summary.min_hum ?? "--";
        document.getElementById("avgHum").textContent = summary.avg_hum ?? "--";
        document.getElementById("maxHum").textContent = summary.max_hum ?? "--";

        document.getElementById("avgRSSI").textContent = summary.avg_rssi ?? "--";

        applyLatestReadingToKPIs(latest);
    } else {
        resetDashboardToEmpty();
    }
}

function resetDashboardToEmpty() {
    document.getElementById("valTemp").textContent = "--.-";
    document.getElementById("valHum").textContent = "--.-";
    document.getElementById("valRSSI").textContent = "--";
    document.getElementById("valRssiQuality").textContent = "--";

    document.getElementById("minTemp").textContent = "--";
    document.getElementById("avgTemp").textContent = "--";
    document.getElementById("maxTemp").textContent = "--";
    document.getElementById("minHum").textContent = "--";
    document.getElementById("avgHum").textContent = "--";
    document.getElementById("maxHum").textContent = "--";
    document.getElementById("avgRSSI").textContent = "--";

    document.getElementById("valPackets").textContent = "0";
    document.getElementById("valDevice").textContent = "--";
    document.getElementById("valClientIP").textContent = "--";
    document.getElementById("valLastSeen").textContent = "--:--";

    const statusBadge = document.getElementById("valStatusBadge");
    if (statusBadge) {
        statusBadge.textContent = "Sin datos";
        statusBadge.className = "status-pill status-SIN_DATOS";
    }

    const alertBanner = document.getElementById("alertBanner");
    if (alertBanner) {
        alertBanner.className = "alert-banner";
    }
}

function applyLatestReadingToKPIs(r) {
    document.getElementById("valTemp").textContent = Number(r.temperature).toFixed(1);
    document.getElementById("valHum").textContent = Number(r.humidity).toFixed(1);
    document.getElementById("valDevice").textContent = r.device_id;
    document.getElementById("valClientIP").textContent = r.client_ip || "--";
    document.getElementById("valLastSeen").textContent = (r.created_at || "").split(" ")[1] || r.created_at;

    const qualityEl = document.getElementById("valRssiQuality");
    if (r.rssi !== null && r.rssi !== undefined) {
        document.getElementById("valRSSI").textContent = r.rssi;
        let quality = "Débil";
        if (r.rssi >= -60) quality = "Excelente";
        else if (r.rssi >= -70) quality = "Buena";
        else if (r.rssi >= -80) quality = "Regular";
        qualityEl.textContent = quality;
    } else {
        document.getElementById("valRSSI").textContent = "--";
        qualityEl.textContent = "N/D";
    }

    const statusBadge = document.getElementById("valStatusBadge");
    statusBadge.textContent = r.status;
    statusBadge.className = `status-pill status-${r.status}`;

    const banner = document.getElementById("alertBanner");
    if (r.status === "ALERTA" || r.status === "CRITICO") {
        banner.className = `alert-banner ${r.status.toLowerCase()}`;
        document.getElementById("alertTitle").textContent =
            r.status === "CRITICO" ? "Crítico" : "Alerta";
        document.getElementById("alertMessage").textContent = `${r.device_id} • ${r.status_detail}`;
        document.getElementById("alertTime").textContent = r.created_at;
    } else {
        banner.className = "alert-banner";
    }
}

function createTableCell(text, label, styleObj = null) {
    const td = document.createElement("td");
    td.dataset.label = label;
    td.textContent = text;
    if (styleObj) {
        Object.assign(td.style, styleObj);
    }
    return td;
}

function renderChartsAndTable() {
    const chronological = [...readingsCache].reverse();
    const labels = chronological.map((r) => (r.created_at || "").split(" ")[1] || r.created_at);
    const temps = chronological.map((r) => r.temperature);
    const hums = chronological.map((r) => r.humidity);

    if (mainChart) {
        mainChart.data.labels = labels;
        mainChart.data.datasets[0].rawValues = temps;
        mainChart.data.datasets[1].rawValues = hums;
        mainChart.data.datasets[0].data = smoothSeries(temps);
        mainChart.data.datasets[1].data = smoothSeries(hums);
        mainChart.update();
    }

    const tbody = document.getElementById("readingsTableBody");
    tbody.innerHTML = "";

    if (readingsCache.length === 0) {
        const tr = document.createElement("tr");
        tr.className = "is-empty";
        const td = document.createElement("td");
        td.colSpan = 8;
        td.className = "table-empty";
        td.textContent = "Sin lecturas registradas.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    const fragment = document.createDocumentFragment();
    readingsCache.slice(0, 30).forEach((r) => {
        const tr = document.createElement("tr");

        const tdId = document.createElement("td");
        tdId.dataset.label = "#";
        const strongId = document.createElement("strong");
        strongId.textContent = `#${r.id}`;
        tdId.appendChild(strongId);
        tr.appendChild(tdId);

        tr.appendChild(createTableCell((r.created_at || "").split(" ")[1] || r.created_at || "", "Hora"));

        const tdDev = document.createElement("td");
        tdDev.dataset.label = "Nodo";
        const codeDev = document.createElement("code");
        codeDev.textContent = r.device_id;
        tdDev.appendChild(codeDev);
        tr.appendChild(tdDev);

        tr.appendChild(createTableCell(r.client_ip || "--", "IP"));
        tr.appendChild(createTableCell(`${Number(r.temperature).toFixed(1)} °C`, "Temp", { color: "#fb923c", fontWeight: "600" }));
        tr.appendChild(createTableCell(`${Number(r.humidity).toFixed(1)} %`, "Hum", { color: "#38bdf8", fontWeight: "600" }));
        tr.appendChild(createTableCell(r.rssi !== null && r.rssi !== undefined ? `${r.rssi} dBm` : "--", "RSSI"));

        const tdStatus = document.createElement("td");
        tdStatus.dataset.label = "Estado";
        const pill = document.createElement("span");
        const safeStatus = ["NORMAL", "ALERTA", "CRITICO"].includes(r.status) ? r.status : "NORMAL";
        pill.className = `status-pill status-${safeStatus}`;
        pill.title = r.status_detail || "";
        pill.textContent = safeStatus;
        tdStatus.appendChild(pill);
        tr.appendChild(tdStatus);

        fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
}

function connectSSE() {
    const pill = document.getElementById("sseStatusPill");
    const text = document.getElementById("sseStatusText");

    const evtSource = new EventSource("/api/stream");

    const markConnected = () => {
        pill.classList.remove("disconnected");
        text.textContent = "En línea";
    };

    evtSource.onopen = markConnected;
    evtSource.addEventListener("connected", markConnected);

    evtSource.addEventListener("new_reading", (event) => {
        try {
            const record = JSON.parse(event.data);
            const filterEl = document.getElementById("deviceFilter");
            const selectedDevice = filterEl ? filterEl.value : "ALL";

            if (selectedDevice === "ALL" || selectedDevice === record.device_id) {
                const limitEl = document.getElementById("sampleLimit");
                const limit = limitEl ? parseInt(limitEl.value, 10) || 50 : 50;
                readingsCache.unshift(record);
                if (readingsCache.length > limit) {
                    readingsCache.pop();
                }
                applyLatestReadingToKPIs(record);
                renderChartsAndTable();
                fetch(`/api/stats?device_id=${encodeURIComponent(selectedDevice)}`)
                    .then((r) => r.json())
                    .then((statsData) => {
                        if (statsData.ok) updateStatsUI(statsData);
                    })
                    .catch(() => {});
            }
        } catch (e) {
            console.error("Error procesando evento SSE:", e);
        }
    });

    evtSource.addEventListener("cleared", () => {
        readingsCache = [];
        renderChartsAndTable();
        resetDashboardToEmpty();
        refreshAllData();
    });

    evtSource.onerror = () => {
        pill.classList.add("disconnected");
        text.textContent = "Reconectando";
    };
}

async function clearAllReadings() {
    if (!confirm("¿Borrar el historial de lecturas?")) return;
    await fetch("/api/readings", { method: "DELETE" });
    refreshAllData();
}
