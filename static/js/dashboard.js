let mainChart = null;
let secondaryChart = null;
let readingsCache = [];
let autoSimTimer = null;
let autoSimPhase = 0;

document.addEventListener("DOMContentLoaded", () => {
    initCharts();
    refreshAllData();
    connectSSE();

    document.getElementById("deviceFilter").addEventListener("change", () => {
        refreshAllData();
    });
});

function initCharts() {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js no disponible en caché; continuando con telemetría tabular y KPIs.");
        return;
    }

    Chart.defaults.color = "#94a3b8";
    Chart.defaults.font.family = "'Inter', sans-serif";

    const ctx1 = document.getElementById("mainTelemetryChart").getContext("2d");
    mainChart = new Chart(ctx1, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Temperatura (°C)",
                    data: [],
                    borderColor: "#f97316",
                    backgroundColor: "rgba(249, 115, 22, 0.14)",
                    borderWidth: 2.5,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    tension: 0.32,
                    fill: true,
                    yAxisID: "yTemp",
                },
                {
                    label: "Humedad Relativa (%)",
                    data: [],
                    borderColor: "#38bdf8",
                    backgroundColor: "rgba(56, 189, 248, 0.10)",
                    borderWidth: 2.5,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    tension: 0.32,
                    fill: true,
                    yAxisID: "yHum",
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false,
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: { usePointStyle: true, boxWidth: 8 },
                },
            },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
                },
                yTemp: {
                    type: "linear",
                    display: true,
                    position: "left",
                    title: { display: true, text: "Temperatura (°C)", color: "#f97316" },
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                },
                yHum: {
                    type: "linear",
                    display: true,
                    position: "right",
                    title: { display: true, text: "Humedad (%)", color: "#38bdf8" },
                    grid: { drawOnChartArea: false },
                },
            },
        },
    });

    const ctx2 = document.getElementById("secondaryChart").getContext("2d");
    secondaryChart = new Chart(ctx2, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Índice de Calor (°C)",
                    data: [],
                    borderColor: "#a855f7",
                    backgroundColor: "rgba(168, 85, 247, 0.12)",
                    borderWidth: 2,
                    pointRadius: 2.5,
                    tension: 0.3,
                    fill: true,
                },
                {
                    label: "Punto de Rocío (°C)",
                    data: [],
                    borderColor: "#10b981",
                    backgroundColor: "transparent",
                    borderDash: [5, 4],
                    borderWidth: 2,
                    pointRadius: 2.5,
                    tension: 0.3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    position: "top",
                    labels: { usePointStyle: true, boxWidth: 8 },
                },
            },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    title: { display: true, text: "Grados (°C)" },
                },
            },
        },
    });
}

async function refreshAllData() {
    const device = document.getElementById("deviceFilter").value;
    const limit = parseInt(document.getElementById("sampleLimit").value, 10) || 50;

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
    const { summary, latest, devices, thresholds } = statsData;

    if (thresholds) {
        document.getElementById("lblWarnTemp").textContent = thresholds.temp_max_warn.toFixed(1);
        document.getElementById("lblCritTemp").textContent = thresholds.temp_max_crit.toFixed(1);
        document.getElementById("lblWarnHum").textContent = thresholds.hum_max_warn.toFixed(1);
    }

    // Actualizar selector de dispositivos dinámicamente
    const select = document.getElementById("deviceFilter");
    const currentSelection = select.value;
    const knownDevices = new Set(["ALL", "ESP32-NODO-01"]);
    if (devices) {
        devices.forEach((d) => knownDevices.add(d.device_id));
    }
    select.innerHTML = "";
    knownDevices.forEach((devId) => {
        const opt = document.createElement("option");
        opt.value = devId;
        opt.textContent = devId === "ALL" ? "Todos los Nodos Sensores" : devId;
        if (devId === currentSelection) opt.selected = true;
        select.appendChild(opt);
    });

    if (summary && summary.total_packets > 0) {
        document.getElementById("valPackets").textContent = summary.total_packets;
        document.getElementById("minTemp").textContent = summary.min_temp ?? "--";
        document.getElementById("avgTemp").textContent = summary.avg_temp ?? "--";
        document.getElementById("maxTemp").textContent = summary.max_temp ?? "--";

        document.getElementById("minHum").textContent = summary.min_hum ?? "--";
        document.getElementById("avgHum").textContent = summary.avg_hum ?? "--";
        document.getElementById("maxHum").textContent = summary.max_hum ?? "--";

        document.getElementById("avgHI").textContent = summary.avg_hi ?? "--";
        document.getElementById("avgRSSI").textContent = summary.avg_rssi ?? "--";
    } else {
        document.getElementById("valPackets").textContent = "0";
    }

    if (latest) {
        applyLatestReadingToKPIs(latest);
    }
}

function applyLatestReadingToKPIs(r) {
    document.getElementById("valTemp").textContent = Number(r.temperature).toFixed(1);
    document.getElementById("valHum").textContent = Number(r.humidity).toFixed(1);
    document.getElementById("valHI").textContent = Number(r.heat_index).toFixed(1);
    document.getElementById("valDP").textContent = Number(r.dew_point).toFixed(1);
    document.getElementById("valRSSI").textContent = r.rssi;
    document.getElementById("valBatt").textContent = Number(r.battery_v).toFixed(2);
    document.getElementById("valDevice").textContent = r.device_id;
    document.getElementById("valClientIP").textContent = r.client_ip || "127.0.0.1";
    document.getElementById("valLastSeen").textContent = (r.created_at || "").split(" ")[1] || r.created_at;

    // Barras de progreso proporcionales
    const tempPct = Math.min(100, Math.max(5, ((r.temperature - 10) / 35) * 100));
    const humPct = Math.min(100, Math.max(5, r.humidity));
    const hiPct = Math.min(100, Math.max(5, ((r.heat_index - 10) / 40) * 100));
    const rssiPct = Math.min(100, Math.max(5, ((r.rssi + 100) / 70) * 100));

    document.getElementById("meterTemp").style.width = `${tempPct}%`;
    document.getElementById("meterHum").style.width = `${humPct}%`;
    document.getElementById("meterHI").style.width = `${hiPct}%`;
    document.getElementById("meterRSSI").style.width = `${rssiPct}%`;

    // Calidad de señal RSSI
    const badgeRSSI = document.getElementById("badgeRSSI");
    if (r.rssi >= -60) badgeRSSI.textContent = "Excelente";
    else if (r.rssi >= -70) badgeRSSI.textContent = "Buena";
    else if (r.rssi >= -80) badgeRSSI.textContent = "Regular";
    else badgeRSSI.textContent = "Débil";

    // Estado general y banner de alerta
    const statusBadge = document.getElementById("valStatusBadge");
    statusBadge.textContent = r.status;
    statusBadge.className = `status-pill status-${r.status}`;

    const banner = document.getElementById("alertBanner");
    if (r.status === "ALERTA" || r.status === "CRITICO") {
        banner.className = `alert-banner ${r.status.toLowerCase()}`;
        document.getElementById("alertTitle").textContent =
            r.status === "CRITICO" ? "🚨 ALERTA CRÍTICA DETECTADA:" : "⚠️ ADVERTENCIA OPERATIVA:";
        document.getElementById("alertMessage").textContent = ` [${r.device_id}] ${r.status_detail}`;
        document.getElementById("alertTime").textContent = r.created_at;
    } else {
        banner.className = "alert-banner";
    }
}

function renderChartsAndTable() {
    const chronological = [...readingsCache].reverse();
    const labels = chronological.map((r) => (r.created_at || "").split(" ")[1] || r.created_at);
    const temps = chronological.map((r) => r.temperature);
    const hums = chronological.map((r) => r.humidity);
    const his = chronological.map((r) => r.heat_index);
    const dps = chronological.map((r) => r.dew_point);

    if (mainChart) {
        mainChart.data.labels = labels;
        mainChart.data.datasets[0].data = temps;
        mainChart.data.datasets[1].data = hums;
        mainChart.update("none");
    }

    if (secondaryChart) {
        secondaryChart.data.labels = labels;
        secondaryChart.data.datasets[0].data = his;
        secondaryChart.data.datasets[1].data = dps;
        secondaryChart.update("none");
    }

    const tbody = document.getElementById("readingsTableBody");
    if (readingsCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text-secondary);">No hay lecturas registradas. Envía una trama desde el transmisor o simulador.</td></tr>`;
        return;
    }

    const rowsHtml = readingsCache.slice(0, 30).map((r) => `
        <tr>
            <td><strong>#${r.id}</strong></td>
            <td>${r.created_at}</td>
            <td><code>${r.device_id}</code></td>
            <td>${r.client_ip || "127.0.0.1"}</td>
            <td style="color: #fb923c; font-weight: 700;">${Number(r.temperature).toFixed(2)} °C</td>
            <td style="color: #38bdf8; font-weight: 700;">${Number(r.humidity).toFixed(2)} %</td>
            <td>${Number(r.heat_index).toFixed(2)} °C</td>
            <td>${Number(r.dew_point).toFixed(2)} °C</td>
            <td>${r.rssi} dBm</td>
            <td><span class="status-pill status-${r.status}" title="${r.status_detail}">${r.status}</span></td>
        </tr>
    `).join("");

    tbody.innerHTML = rowsHtml;
}

function connectSSE() {
    const pill = document.getElementById("sseStatusPill");
    const text = document.getElementById("sseStatusText");

    const evtSource = new EventSource("/api/stream");

    evtSource.addEventListener("connected", () => {
        pill.classList.remove("disconnected");
        text.textContent = "Stream SSE Activo";
    });

    evtSource.addEventListener("new_reading", (event) => {
        try {
            const record = JSON.parse(event.data);
            const selectedDevice = document.getElementById("deviceFilter").value;
            if (selectedDevice === "ALL" || selectedDevice === record.device_id) {
                const limit = parseInt(document.getElementById("sampleLimit").value, 10) || 50;
                readingsCache.unshift(record);
                if (readingsCache.length > limit) {
                    readingsCache.pop();
                }
                applyLatestReadingToKPIs(record);
                renderChartsAndTable();
                // Actualizar estadísticas agregadas
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
        refreshAllData();
    });

    evtSource.onerror = () => {
        pill.classList.add("disconnected");
        text.textContent = "Reconectando SSE...";
    };
}

async function transmitReadingPayload(payload) {
    const t0 = performance.now();
    try {
        const res = await fetch("/api/readings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const elapsed = Math.round(performance.now() - t0);
        const data = await res.json();

        document.getElementById("inspectorLatency").textContent = `Latencia: ${elapsed} ms (HTTP ${res.status})`;
        document.getElementById("protocolInspector").textContent =
`POST /api/readings HTTP/1.1
Host: ${window.location.host}
Content-Type: application/json

// --- TRAMA JSON ENVIADA POR EL SENSOR ---
${JSON.stringify(payload, null, 2)}

// --- RESPUESTA DEL SERVIDOR EN LA NUBE ---
${JSON.stringify(data, null, 2)}`;
    } catch (err) {
        console.error("Error transmitiendo lectura:", err);
    }
}

function sendManualReading() {
    const device_id = document.getElementById("simDevice").value.trim() || "ESP32-NODO-01";
    const temperature = parseFloat(document.getElementById("simTemp").value) || 25.5;
    const humidity = parseFloat(document.getElementById("simHum").value) || 58.0;
    const rssi = parseInt(document.getElementById("simRSSI").value, 10) || -58;

    transmitReadingPayload({
        device_id,
        location: "Laboratorio Comunicaciones II",
        temperature,
        humidity,
        rssi,
        battery_v: 3.32,
    });
}

function sendPreset(temp, hum, rssi) {
    document.getElementById("simTemp").value = temp;
    document.getElementById("simHum").value = hum;
    document.getElementById("simRSSI").value = rssi;
    sendManualReading();
}

function toggleWebAutoSim() {
    const btn = document.getElementById("btnAutoSim");
    if (autoSimTimer) {
        clearInterval(autoSimTimer);
        autoSimTimer = null;
        btn.classList.remove("active");
        btn.textContent = "▶ Auto-Simulador Web (3s)";
        return;
    }

    btn.classList.add("active");
    btn.textContent = "⏹ Detener Auto-Simulador (Activo)";

    const emitStep = () => {
        autoSimPhase += 0.35;
        const temp = +(25.8 + Math.sin(autoSimPhase) * 2.8 + (Math.random() - 0.5) * 0.6).toFixed(2);
        const hum = +(58.0 - Math.sin(autoSimPhase) * 6.5 + (Math.random() - 0.5) * 1.4).toFixed(2);
        const rssi = Math.round(-56 + (Math.random() - 0.5) * 10);

        document.getElementById("simTemp").value = temp;
        document.getElementById("simHum").value = hum;
        document.getElementById("simRSSI").value = rssi;

        transmitReadingPayload({
            device_id: document.getElementById("simDevice").value.trim() || "ESP32-NODO-01",
            location: "Laboratorio Comunicaciones II",
            temperature: temp,
            humidity: hum,
            rssi: rssi,
            battery_v: +(3.30 + Math.random() * 0.05).toFixed(2),
        });
    };

    emitStep();
    autoSimTimer = setInterval(emitStep, 3000);
}

async function seedDemoData() {
    await fetch("/api/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 15, device_id: "ESP32-NODO-01" }),
    });
    refreshAllData();
}

async function clearAllReadings() {
    if (!confirm("¿Deseas borrar todo el historial de telemetría de la base de datos?")) return;
    await fetch("/api/readings", { method: "DELETE" });
    refreshAllData();
}
