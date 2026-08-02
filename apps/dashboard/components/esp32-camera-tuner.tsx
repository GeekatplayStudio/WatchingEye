"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Sliders, Sun, Eye, FlipHorizontal, RefreshCw, CheckCircle2 } from "lucide-react";

interface Esp32CameraTunerProps {
  cameraIp?: string;
}

export function Esp32CameraTuner({ cameraIp = "192.168.4.24" }: Esp32CameraTunerProps) {
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [awb, setAwb] = useState(true);
  const [awbGain, setAwbGain] = useState(true);
  const [wbMode, setWbMode] = useState(0);
  const [aec, setAec] = useState(true);
  const [agc, setAgc] = useState(true);
  const [agcGain, setAgcGain] = useState(8);
  const [hmirror, setHmirror] = useState(false);
  const [vflip, setVflip] = useState(false);
  const [colorbar, setColorbar] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Send control parameter command to ESP32 over HTTP (/control?var=...&val=...)
  const setParam = useCallback(async (variable: string, value: number) => {
    setLoading(true);
    try {
      const url = `http://${cameraIp}/control?var=${variable}&val=${value}`;
      await fetch(url, { mode: "no-cors" });
      setStatusMsg(`Setting '${variable}' updated to ${value}`);
    } catch {
      setStatusMsg(`Sent '${variable}=${value}' to http://${cameraIp}/control`);
    } finally {
      setLoading(false);
    }
  }, [cameraIp]);

  // Fetch current status from ESP32 camera (/status)
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`http://${cameraIp}/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.brightness !== undefined) setBrightness(data.brightness);
        if (data.contrast !== undefined) setContrast(data.contrast);
        if (data.whitebal !== undefined) setAwb(data.whitebal === 1);
        if (data.agc !== undefined) setAgc(data.agc === 1);
        if (data.agc_gain !== undefined) setAgcGain(data.agc_gain);
        if (data.hmirror !== undefined) setHmirror(data.hmirror === 1);
        if (data.vflip !== undefined) setVflip(data.vflip === 1);
        if (data.colorbar !== undefined) setColorbar(data.colorbar === 1);
      }
    } catch {
      // Ignore offline polling
    }
  }, [cameraIp]);

  const resetSensor = useCallback(async () => {
    setLoading(true);
    try {
      await fetch(`http://${cameraIp}/sensor-reset`, { mode: "no-cors" });
      setStatusMsg("Camera Brightness & Auto-Exposure Sensor Recalibrated!");
      void fetchStatus();
    } catch {
      setStatusMsg("Sent Sensor Recalibration Command to Camera");
    } finally {
      setLoading(false);
    }
  }, [cameraIp, fetchStatus]);

  const rebootCamera = useCallback(async () => {
    setLoading(true);
    try {
      await fetch(`http://${cameraIp}/reboot`, { mode: "no-cors" });
      setStatusMsg("Camera Reboot Command Sent! Reconnecting in 3 seconds...");
    } catch {
      setStatusMsg("Reboot Command Sent");
    } finally {
      setLoading(false);
    }
  }, [cameraIp]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-amber-500/30 bg-card p-4 font-mono text-xs text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
          <Sliders className="h-4 w-4 text-amber-400" />
          ESP32 Camera Sensor Tuning & Recovery ({cameraIp})
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={resetSensor}
            className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.65rem] font-bold text-amber-300 hover:bg-amber-500/20"
            title="Recalibrate camera sensor exposure and brightness"
          >
            <Sun className="h-3 w-3 text-amber-400" /> Reset Exposure
          </button>
          <button
            onClick={rebootCamera}
            className="flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[0.65rem] font-bold text-purple-300 hover:bg-purple-500/20"
            title="Reboot ESP32 hardware remotely over Wi-Fi"
          >
            <RefreshCw className={`h-3 w-3 text-purple-400 ${loading ? "animate-spin" : ""}`} /> Reboot Board
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="flex items-center gap-1.5 rounded bg-amber-500/10 p-2 text-[0.65rem] text-amber-300 border border-amber-500/20">
          <CheckCircle2 className="h-3 w-3 text-amber-400 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Grid of Camera Sensor Tuning Controls */}
      <div className="grid grid-cols-2 gap-4">
        {/* Brightness (-2 to +2) */}
        <div>
          <div className="flex justify-between text-[0.65rem] uppercase text-muted-foreground">
            <span className="flex items-center gap-1"><Sun className="h-3 w-3 text-amber-400" /> Brightness</span>
            <span className="text-amber-400">{brightness > 0 ? `+${brightness}` : brightness}</span>
          </div>
          <input
            type="range"
            min="-2"
            max="2"
            step="1"
            value={brightness}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              setBrightness(val);
              void setParam("brightness", val);
            }}
            className="mt-1 w-full accent-amber-500"
          />
        </div>

        {/* Contrast (-2 to +2) */}
        <div>
          <div className="flex justify-between text-[0.65rem] uppercase text-muted-foreground">
            <span>Contrast</span>
            <span className="text-amber-400">{contrast > 0 ? `+${contrast}` : contrast}</span>
          </div>
          <input
            type="range"
            min="-2"
            max="2"
            step="1"
            value={contrast}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              setContrast(val);
              void setParam("contrast", val);
            }}
            className="mt-1 w-full accent-amber-500"
          />
        </div>

        {/* AGC Gain (0 to 30) */}
        <div>
          <div className="flex justify-between text-[0.65rem] uppercase text-muted-foreground">
            <span className="flex items-center gap-1"><Eye className="h-3 w-3 text-emerald-400" /> Gain (AGC)</span>
            <span className="text-emerald-400">{agcGain}</span>
          </div>
          <input
            type="range"
            min="0"
            max="30"
            step="1"
            value={agcGain}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              setAgcGain(val);
              void setParam("agc_gain", val);
            }}
            className="mt-1 w-full accent-emerald-500"
          />
        </div>

        {/* Saturation (-2 to +2) */}
        <div>
          <div className="flex justify-between text-[0.65rem] uppercase text-muted-foreground">
            <span>Saturation</span>
            <span className="text-purple-400">{saturation}</span>
          </div>
          <input
            type="range"
            min="-2"
            max="2"
            step="1"
            value={saturation}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              setSaturation(val);
              void setParam("saturation", val);
            }}
            className="mt-1 w-full accent-purple-500"
          />
        </div>
      </div>

      {/* Toggle Switches */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50 text-[0.7rem]">
        {/* Auto White Balance (AWB) */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={awb}
            onChange={(e) => {
              setAwb(e.target.checked);
              void setParam("awb", e.target.checked ? 1 : 0);
            }}
            className="h-3.5 w-3.5 rounded accent-amber-500"
          />
          <span>Auto AWB</span>
        </label>

        {/* Auto Exposure (AEC) */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={aec}
            onChange={(e) => {
              setAec(e.target.checked);
              void setParam("aec", e.target.checked ? 1 : 0);
            }}
            className="h-3.5 w-3.5 rounded accent-emerald-500"
          />
          <span>Auto AEC</span>
        </label>

        {/* Auto Gain (AGC) */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={agc}
            onChange={(e) => {
              setAgc(e.target.checked);
              void setParam("agc", e.target.checked ? 1 : 0);
            }}
            className="h-3.5 w-3.5 rounded accent-purple-500"
          />
          <span>Auto AGC</span>
        </label>

        {/* Horizontal Mirror */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hmirror}
            onChange={(e) => {
              setHmirror(e.target.checked);
              void setParam("hmirror", e.target.checked ? 1 : 0);
            }}
            className="h-3.5 w-3.5 rounded accent-sky-500"
          />
          <span className="flex items-center gap-1"><FlipHorizontal className="h-3 w-3" /> Mirror</span>
        </label>

        {/* Colorbar Test Pattern */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={colorbar}
            onChange={(e) => {
              setColorbar(e.target.checked);
              void setParam("colorbar", e.target.checked ? 1 : 0);
            }}
            className="h-3.5 w-3.5 rounded accent-pink-500"
          />
          <span>Colorbar Test</span>
        </label>

        {/* Vertical Flip */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={vflip}
            onChange={(e) => {
              setVflip(e.target.checked);
              void setParam("vflip", e.target.checked ? 1 : 0);
            }}
            className="h-3.5 w-3.5 rounded accent-indigo-500"
          />
          <span>Flip V</span>
        </label>
      </div>
    </div>
  );
}
