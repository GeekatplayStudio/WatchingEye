export const MUTED_COLORS = {
  blue: "#7C93B5",
  teal: "#6FA69C",
  purple: "#9285AD",
  amber: "#B99B72",
  emerald: "#6FA98A",
  rose: "#AD8288",
  violet: "#9483AD",
  cyan: "#7FAAB0",
  fuchsia: "#AD8BB0",
  red: "#B57676",
  indigo: "#8686AD",
} as const;

export const getPortColor = (type: "trigger" | "data", dataType?: string) => {
  if (type === "trigger") return MUTED_COLORS.amber;
  if (dataType === "number") return MUTED_COLORS.emerald;
  if (dataType === "boolean") return MUTED_COLORS.teal;
  if (dataType === "string") return MUTED_COLORS.purple;
  return MUTED_COLORS.blue;
};

export const getCategoryStyles = (category: string, selected: boolean) => {
  const styles: Record<string, { headerBg: string; border: string; accent: string }> = {
    Inputs: {
      headerBg: "bg-[#7C93B5]/35 text-zinc-50 border-[#7C93B5]/40",
      border: selected ? "border-[#7C93B5] shadow-[0_0_12px_rgba(124,147,181,0.3)]" : "border-zinc-700",
      accent: "bg-[#7C93B5]",
    },
    Logic: {
      headerBg: "bg-[#6FA69C]/35 text-zinc-50 border-[#6FA69C]/40",
      border: selected ? "border-[#6FA69C] shadow-[0_0_12px_rgba(111,166,156,0.3)]" : "border-zinc-700",
      accent: "bg-[#6FA69C]",
    },
    "Control Flow": {
      headerBg: "bg-[#9285AD]/35 text-zinc-50 border-[#9285AD]/40",
      border: selected ? "border-[#9285AD] shadow-[0_0_12px_rgba(146,133,173,0.3)]" : "border-zinc-700",
      accent: "bg-[#9285AD]",
    },
    "Math & Compare": {
      headerBg: "bg-[#B99B72]/35 text-zinc-50 border-[#B99B72]/40",
      border: selected ? "border-[#B99B72] shadow-[0_0_12px_rgba(185,155,114,0.3)]" : "border-zinc-700",
      accent: "bg-[#B99B72]",
    },
    "Data & Text": {
      headerBg: "bg-[#6FA98A]/35 text-zinc-50 border-[#6FA98A]/40",
      border: selected ? "border-[#6FA98A] shadow-[0_0_12px_rgba(111,169,138,0.3)]" : "border-zinc-700",
      accent: "bg-[#6FA98A]",
    },
    Outputs: {
      headerBg: "bg-[#AD8288]/35 text-zinc-50 border-[#AD8288]/40",
      border: selected ? "border-[#AD8288] shadow-[0_0_12px_rgba(173,130,136,0.3)]" : "border-zinc-700",
      accent: "bg-[#AD8288]",
    },
    "AI & Scripts": {
      headerBg: "bg-[#9483AD]/35 text-zinc-50 border-[#9483AD]/40",
      border: selected ? "border-[#9483AD] shadow-[0_0_12px_rgba(148,131,173,0.3)]" : "border-zinc-700",
      accent: "bg-[#9483AD]",
    },
    "Neural Network": {
      headerBg: "bg-[#8686AD]/35 text-zinc-50 border-[#8686AD]/40",
      border: selected ? "border-[#8686AD] shadow-[0_0_12px_rgba(134,134,173,0.3)]" : "border-zinc-700",
      accent: "bg-[#8686AD]",
    },
    "AI Model": {
      headerBg: "bg-[#7FAAB0]/35 text-zinc-50 border-[#7FAAB0]/40",
      border: selected ? "border-[#7FAAB0] shadow-[0_0_12px_rgba(127,170,176,0.3)]" : "border-zinc-700",
      accent: "bg-[#7FAAB0]",
    },
  };
  return styles[category] || styles.Logic;
};

export const getExecutionStyles = (state: string = "idle") => {
  const styles: Record<string, string> = {
    idle: "",
    running: "ring-2 ring-[#D8B98A] shadow-[0_0_22px_rgba(216,185,138,0.55)] animate-pulse",
    success: "ring-2 ring-[#8FCBA8] shadow-[0_0_18px_rgba(143,203,168,0.45)] transition-all duration-300",
    error: "ring-2 ring-[#D68F8F] shadow-[0_0_18px_rgba(214,143,143,0.5)]",
  };
  return styles[state] || "";
};
