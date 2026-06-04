"use client";

import { useEffect, useRef } from "react";
// @ts-ignore - Anime.js v4 types might not be perfectly matched with the installed v3 @types, but this is the correct v4 import
import { animate, svg } from "animejs";

export function AnimatedTitle() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // anime.js v4 stroke drawing animation (matches the requested effect exactly)
    animate(svg.createDrawable(".mindvault-line"), {
      draw: ["0 0", "0 1", "1 1"],
      ease: "inOutQuad",
      duration: 3000,
      loop: true,
    });
  }, []);

  return (
    <div className="w-full mb-6 mt-[-20px]">
      <svg
        ref={svgRef}
        viewBox="0 0 500 120"
        className="w-full max-w-lg overflow-visible drop-shadow-[0_0_25px_rgba(59,130,246,0.8)]"
        preserveAspectRatio="xMinYMid meet"
      >
        <defs>
          <linearGradient id="title-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="50%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
        <text
          x="0"
          y="90"
          className="mindvault-line font-extrabold tracking-tight"
          style={{ fontSize: "95px", fontFamily: "inherit" }}
          fill="transparent"
          stroke="url(#title-gradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          MindVault
        </text>
      </svg>
    </div>
  );
}
