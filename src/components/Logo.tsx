interface LogoMarkProps {
  size?: number;
  className?: string;
}

/** Animated radar-ring logo mark for RevenueRadar */
export function LogoMark({ size = 36, className = "" }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer ring */}
      <circle cx="20" cy="20" r="18" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.25" />
      {/* Mid ring */}
      <circle cx="20" cy="20" r="13" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.45" />
      {/* Inner ring */}
      <circle cx="20" cy="20" r="8"  stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.7" />
      {/* Radar beam */}
      <line x1="20" y1="20" x2="33" y2="7" stroke="url(#beamGrad)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Active blip dot */}
      <circle cx="29.5" cy="10.5" r="2.5" fill="#22d3ee" className="logo-blip" />
      {/* Center pivot */}
      <circle cx="20" cy="20" r="2.5" fill="#6366f1" />
      <defs>
        <linearGradient id="beamGrad" x1="20" y1="20" x2="33" y2="7" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366f1" stopOpacity="0.1" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0.9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface LogoFullProps {
  dark?: boolean;
  size?: "sm" | "md" | "lg";
}

/** Full wordmark: icon + "RevenueRadar" */
export function LogoFull({ dark = false, size = "md" }: LogoFullProps) {
  const iconSize = size === "lg" ? 42 : size === "sm" ? 28 : 34;
  const nameClass =
    size === "lg"
      ? "text-2xl"
      : size === "sm"
      ? "text-base"
      : "text-xl";

  return (
    <div className="flex items-center gap-2.5 select-none">
      <div className="relative">
        <LogoMark size={iconSize} />
        {/* Sweep animation overlay */}
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 40 40"
          className="absolute inset-0 logo-sweep"
          style={{ transformOrigin: "20px 20px" }}
        >
          <path
            d="M20 20 L20 3"
            stroke="url(#sweepGrad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.6"
          />
          <defs>
            <linearGradient id="sweepGrad" x1="20" y1="20" x2="20" y2="3" gradientUnits="userSpaceOnUse">
              <stop stopColor="#6366f1" stopOpacity="0" />
              <stop offset="1" stopColor="#818cf8" stopOpacity="0.8" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div>
        <h1
          className={`${nameClass} font-bold tracking-tight leading-none ${
            dark ? "text-white" : "text-slate-900"
          }`}
        >
          Revenue<span className={dark ? "text-indigo-400" : "text-indigo-600"}>Radar</span>
        </h1>
        <p
          className={`text-[9px] font-mono tracking-widest uppercase leading-none mt-0.5 ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}
        >
          GTM Intelligence
        </p>
      </div>
    </div>
  );
}
