"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, Camera, ShieldCheck, Code2, Radio, Binary, GitBranch, Sliders, X, Sparkles } from "lucide-react";
import { NODE_DEFINITIONS, NodeDefinition } from "@/lib/logiboard/node-definitions";

interface QuickSearchMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  onClose: () => void;
  onSelectNode: (nodeType: string, flowX: number, flowY: number) => void;
}

const CATEGORY_ICONS: Record<string, any> = {
  Inputs: Camera,
  Logic: Binary,
  "Control Flow": GitBranch,
  "Math & Compare": Sliders,
  "AI & Scripts": ShieldCheck,
  Outputs: Radio,
};

const CATEGORY_COLORS: Record<string, string> = {
  Inputs: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  Logic: "text-teal-400 border-teal-500/30 bg-teal-500/10",
  "Control Flow": "text-purple-400 border-purple-500/30 bg-purple-500/10",
  "Math & Compare": "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  "AI & Scripts": "text-amber-400 border-amber-500/30 bg-amber-500/10",
  Outputs: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

export function QuickSearchMenu({
  isOpen,
  x,
  y,
  flowX,
  flowY,
  onClose,
  onSelectNode,
}: QuickSearchMenuProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const allDefinitions = Object.values(NODE_DEFINITIONS);

  const filteredNodes = allDefinitions.filter((def) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      def.label.toLowerCase().includes(q) ||
      def.type.toLowerCase().includes(q) ||
      def.category.toLowerCase().includes(q) ||
      def.description.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredNodes.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredNodes.length) % Math.max(1, filteredNodes.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredNodes[selectedIndex]) {
          onSelectNode(filteredNodes[selectedIndex].type, flowX, flowY);
          onClose();
        }
      }
    };

    if (isOpen) {
      window.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, filteredNodes, selectedIndex, flowX, flowY, onSelectNode, onClose]);

  if (!isOpen) return null;

  // Clamp screen coordinates so context search menu doesn't overflow viewport edges
  const screenW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const screenH = typeof window !== "undefined" ? window.innerHeight : 800;
  const clampedX = Math.min(x, screenW - 320);
  const clampedY = Math.min(y, screenH - 420);

  return (
    <div
      ref={menuRef}
      style={{ left: clampedX, top: clampedY }}
      className="fixed z-50 w-72 rounded-xl border border-zinc-700 bg-zinc-950/95 backdrop-blur-xl p-3 shadow-2xl font-mono text-xs flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-100"
    >
      {/* ComfyUI Header & Search Input */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-1.5 text-[0.7rem] font-bold uppercase tracking-wider text-amber-400">
          <Sparkles className="h-3.5 w-3.5" />
          <span>ComfyUI Node Loader</span>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          placeholder="Search nodes... (e.g. 'cat', 'if', 'code')"
          className="w-full rounded border border-zinc-800 bg-zinc-900 pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
        />
      </div>

      {/* Node Search Results List */}
      <div className="max-h-64 overflow-y-auto flex flex-col gap-1 pr-1">
        {filteredNodes.length === 0 ? (
          <div className="p-4 text-center text-[0.65rem] text-zinc-500">
            No matching nodes found for &quot;{query}&quot;
          </div>
        ) : (
          filteredNodes.map((def, idx) => {
            const Icon = CATEGORY_ICONS[def.category] || Code2;
            const colorClass = CATEGORY_COLORS[def.category] || "text-zinc-400";
            const isSelected = idx === selectedIndex;

            return (
              <div
                key={def.type}
                onClick={() => {
                  onSelectNode(def.type, flowX, flowY);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`flex items-center justify-between p-2 rounded cursor-pointer transition-all border ${
                  isSelected
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                    : "bg-zinc-900/60 border-zinc-800/80 text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2 font-semibold text-xs truncate">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span className="truncate">{def.label}</span>
                  </div>
                  <span className="text-[0.6rem] text-zinc-400 truncate">{def.description}</span>
                </div>

                <span className={`text-[0.6rem] px-1.5 py-0.5 rounded border uppercase font-mono shrink-0 ml-2 ${colorClass}`}>
                  {def.category}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="flex justify-between items-center text-[0.6rem] text-zinc-500 border-t border-zinc-800 pt-1.5 px-1">
        <span>Press <kbd className="bg-zinc-800 px-1 rounded text-zinc-300">↑↓</kbd> to navigate</span>
        <span><kbd className="bg-zinc-800 px-1 rounded text-zinc-300">Enter</kbd> to spawn</span>
      </div>
    </div>
  );
}
