let mainChart = null;
let secondaryChart = null;
let readingsCache = [];
let thresholdsPopulated = false;

document.addEventListener("DOMContentLoaded", () => {
    const endpointEl = document.getElementById("endpointUrl");
    if (endpointEl) {
        endpointEl.textContent = `${window.location.origin}/api/readings`;
    }

    initCharts();
    refreshAllData();
    connectSSE();

    document.getElementById("deviceFilter").addEventListener("change", () => {
        refreshAllData();
    });
});

function initCharts() {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js no disponible; continuando con telemetría tabular y KPIs.");
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

function applyThresholdsToUI(thresholds, forceInputs = false) {
    if (!thresholds) return;
    document.getElementById("lblWarnTemp").textContent = Number(thresholds.temp_max_warn).toFixed(1);
    document.getElementById("lblCritTemp").textContent = Number(thresholds.temp_max_crit).toFixed(1);
    document.getElementById("lblWarnHum").textContent = Number(thresholds.hum_max_warn).toFixed(1);

    if (!thresholdsPopulated || forceInputs) {
        document.getElementById("inpTempMinWarn").value = thresholds.temp_min_warn;
        document.getElementById("inpTempMaxWarn").value = thresholds.temp_max_warn;
        document.getElementById("inpTempMaxCrit").value = thresholds.temp_max_crit;
        document.getElementById("inpHumMinWarn").value = thresholds.hum_min_warn;
        document.getElementById("inpHumMaxWarn").value = thresholds.hum_max_warn;
        document.getElementById("inpHumMaxCrit").value = thresholds.hum_max_crit;
        thresholdsPopulated = true;
    }
}

function updateStatsUI(statsData) {
    const { summary, latest, devices, thresholds } = statsData;

    applyThresholdsToUI(thresholds);

    // Actualizar selector de dispositivos dinámicamente con nodos reales
    const select = document.getElementById("deviceFilter");
    const currentSelection = select.value;
    const knownDevices = new Set(["ALL"]);
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

    if (summary && summary.total_packets > 0 && latest) {
        document.getElementById("valPackets").textContent = summary.total_packets;
        document.getElementById("minTemp").textContent = summary.min_temp ?? "--";
        document.getElementById("avgTemp").textContent = summary.avg_temp ?? "--";
        document.getElementById("maxTemp").textContent = summary.max_temp ?? "--";

        document.getElementById("minHum").textContent = summary.min_hum ?? "--";
        document.getElementById("avgHum").textContent = summary.avg_hum ?? "--";
        document.getElementById("maxHum").textContent = summary.max_hum ?? "--";

        document.getElementById("avgHI").textContent = summary.avg_hi ?? "--";
        document.getElementById("avgRSSI").textContent = summary.avg_rssi ?? "--";

        applyLatestReadingToKPIs(latest);
        updateProtocolInspector(latest);
    } else {
        resetDashboardToEmpty();
    }
}

function resetDashboardToEmpty() {
    document.getElementById("valTemp").textContent = "--.-";
    document.getElementById("valHum").textContent = "--.-";
    document.getElementById("valHI").textContent = "--.-";
    document.getElementById("valDP").textContent = "--.-";
    document.getElementById("valRSSI").textContent = "--";
    document.getElementById("valRssiQuality").textContent = "--";
    document.getElementById("badgeRSSI").textContent = "802.11 b/g/n";

    document.getElementById("minTemp").textContent = "--";
    document.getElementById("avgTemp").textContent = "--";
    document.getElementById("maxTemp").textContent = "--";
    document.getElementById("minHum").textContent = "--";
    document.getElementById("avgHum").textContent = "--";
    document.getElementById("maxHum").textContent = "--";
    document.getElementById("avgHI").textContent = "--";
    document.getElementById("avgRSSI").textContent = "--";

    document.getElementById("valPackets").textContent = "0";
    document.getElementById("valDevice").textContent = "--";
    document.getElementById("valClientIP").textContent = "--";
    document.getElementById("valLastSeen").textContent = "--:--:--";

    document.getElementById("meterTemp").style.width = "0%";
    document.getElementById("meterHum").style.width = "0%";
    document.getElementById("meterHI").style.width = "0%";
    document.getElementById("meterRSSI").style.width = "0%";

    const statusBadge = document.getElementById("valStatusBadge");
    statusBadge.textContent = "SIN DATOS";
    statusBadge.className = "status-pill status-SIN_DATOS";

    document.getElementById("alertBanner").className = "alert-banner";
    document.getElementById("inspectorMeta").textContent = "Esperando datos...";
    document.getElementById("protocolInspector").textContent =
        `Esperando la primera trama real del dispositivo sensor en:\nPOST ${window.location.origin}/api/readings`;
}

function applyLatestReadingToKPIs(r) {
    document.getElementById("valTemp").textContent = Number(r.temperature).toFixed(1);
    document.getElementById("valHum").textContent = Number(r.humidity).toFixed(1);
    document.getElementById("valHI").textContent = Number(r.heat_index).toFixed(1);
    document.getElementById("valDP").textContent = Number(r.dew_point).toFixed(1);
    document.getElementById("valDevice").textContent = r.device_id;
    document.getElementById("valClientIP").textContent = r.client_ip || "--";
    document.getElementById("valLastSeen").textContent = (r.created_at || "").split(" ")[1] || r.created_at;

    const tempPct = Math.min(100, Math.max(5, ((r.temperature - 10) / 35) * 100));
    const humPct = Math.min(100, Math.max(5, r.humidity));
    const hiPct = Math.min(100, Math.max(5, ((r.heat_index - 10) / 40) * 100));

    document.getElementById("meterTemp").style.width = `${tempPct}%`;
    document.getElementById("meterHum").style.width = `${humPct}%`;
    document.getElementById("meterHI").style.width = `${hiPct}%`;

    const badgeRSSI = document.getElementById("badgeRSSI");
    const qualityEl = document.getElementById("valRssiQuality");
    if (r.rssi !== null && r.rssi !== undefined) {
        document.getElementById("valRSSI").textContent = r.rssi;
        const rssiPct = Math.min(100, Math.max(5, ((r.rssi + 100) / 70) * 100));
        document.getElementById("meterRSSI").style.width = `${rssiPct}%`;

        let quality = "Débil";
        if (r.rssi >= -60) quality = "Excelente";
        else if (r.rssi >= -70) quality = "Buena";
        else if (r.rssi >= -80) quality = "Regular";
        badgeRSSI.textContent = quality;
        qualityEl.textContent = quality;
    } else {
        document.getElementById("valRSSI").textContent = "--";
        document.getElementById("meterRSSI").style.width = "0%";
        badgeRSSI.textContent = "N/D";
        qualityEl.textContent = "N/D";
    }

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

function updateProtocolInspector(r) {
    if (!r) return;
    document.getElementById("inspectorMeta").textContent = `IP: ${r.client_ip || "--"} • ${r.created_at}`;

    const sensorPayload = {
        device_id: r.device_id,
        location: r.location,
        temperature: r.temperature,
        humidity: r.humidity,
    };
    if (r.rssi !== null && r.rssi !== undefined) sensorPayload.rssi = r.rssi;
    if (r.battery_v !== null && r.battery_v !== undefined) sensorPayload.battery_v = r.battery_v;

    const serverComputed = {
        id: r.id,
        heat_index: r.heat_index,
        dew_point: r.dew_point,
        status: r.status,
        status_detail: r.status_detail,
        client_ip: r.client_ip,
        created_at: r.created_at,
    };

    document.getElementById("protocolInspector").textContent =
`POST /api/readings HTTP/1.1
Host: ${window.location.host}
Content-Type: application/json

// --- TRAMA RECIBIDA DEL SENSOR ---
${JSON.stringify(sensorPayload, null, 2)}

// --- PROCESAMIENTO EN SERVIDOR ---
${JSON.stringify(serverComputed, null, 2)}`;
}

function createTableCell(text, styleObj = null) {
    const td = document.createElement("td");
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
    tbody.innerHTML = "";

    if (readingsCache.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 10;
        td.style.textAlign = "center";
        td.style.color = "var(--text-secondary)";
        td.textContent = "No hay lecturas registradas. Esperando telemetría del dispositivo sensor en POST /api/readings.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    const fragment = document.createDocumentFragment();
    readingsCache.slice(0, 30).forEach((r) => {
        const tr = document.createElement("tr");

        const tdId = document.createElement("td");
        const strongId = document.createElement("strong");
        strongId.textContent = `#${r.id}`;
        tdId.appendChild(strongId);
        tr.appendChild(tdId);

        tr.appendChild(createTableCell(r.created_at || ""));

        const tdDev = document.createElement("td");
        const codeDev = document.createElement("code");
        codeDev.textContent = r.device_id;
        tdDev.appendChild(codeDev);
        tr.appendChild(tdDev);

        tr.appendChild(createTableCell(r.client_ip || "--"));
        tr.appendChild(createTableCell(`${Number(r.temperature).toFixed(2)} °C`, { color: "#fb923c", fontWeight: "700" }));
        tr.appendChild(createTableCell(`${Number(r.humidity).toFixed(2)} %`, { color: "#38bdf8", fontWeight: "700" }));
        tr.appendChild(createTableCell(`${Number(r.heat_index).toFixed(2)} °C`));
        tr.appendChild(createTableCell(`${Number(r.dew_point).toFixed(2)} °C`));
        tr.appendChild(createTableCell(r.rssi !== null && r.rssi !== undefined ? `${r.rssi} dBm` : "--"));

        const tdStatus = document.createElement("td");
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
        text.textContent = "Stream SSE Activo";
    };

    evtSource.onopen = markConnected;
    evtSource.addEventListener("connected", markConnected);

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
                updateProtocolInspector(record);
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

    evtSource.addEventListener("thresholds_updated", (event) => {
        try {
            const updated = JSON.parse(event.data);
            applyThresholdsToUI(updated, true);
        } catch (e) {
            console.error("Error procesando actualización de umbrales:", e);
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
        text.textContent = "Reconectando SSE...";
    };
}

async function saveThresholds(event) {
    event.preventDefault();
    const feedback = document.getElementById("thresholdsFeedback");
    feedback.className = "feedback-msg";
    feedback.textContent = "Guardando...";

    const payload = {
        temp_min_warn: parseFloat(document.getElementById("inpTempMinWarn").value),
        temp_max_warn: parseFloat(document.getElementById("inpTempMaxWarn").value),
        temp_max_crit: parseFloat(document.getElementById("inpTempMaxCrit").value),
        hum_min_warn: parseFloat(document.getElementById("inpHumMinWarn").value),
        hum_max_warn: parseFloat(document.getElementById("inpHumMaxWarn").value),
        hum_max_crit: parseFloat(document.getElementById("inpHumMaxCrit").value),
    };

    try {
        const res = await fetch("/api/thresholds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            feedback.className = "feedback-msg error";
            feedback.textContent = data.error || "Error al guardar umbrales.";
            return;
        }
        applyThresholdsToUI(data.thresholds, true);
        feedback.className = "feedback-msg success";
        feedback.textContent = "✓ Umbrales guardados.";
        setTimeout(() => {
            if (feedback.textContent === "✓ Umbrales guardados.") {
                feedback.textContent = "";
            }
        }, 3500);
    } catch (err) {
        feedback.className = "feedback-msg error";
        feedback.textContent = "Error de red al guardar umbrales.";
    }
}

async function copyEndpointUrl() {
    const url = `${window.location.origin}/api/readings`;
    const btn = document.getElementById("btnCopyEndpoint");
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
        }
        btn.textContent = "✓ Copiado";
        setTimeout(() => {
            btn.textContent = "📋 Copiar URL";
        }, 2000);
    } catch {
        btn.textContent = "URL visible arriba";
    }
}

async function clearAllReadings() {
    if (!confirm("¿Deseas borrar todo el historial de telemetría de la base de datos?")) return;
    await fetch("/api/readings", { method: "DELETE" });
    refreshAllData();
}
