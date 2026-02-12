"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface OpenForkLogoProps {
  className?: string;
  size?: number | string;
  animate?: boolean;
}

export function OpenForkLogo({ 
  className, 
  size = 48,
  animate = true 
}: OpenForkLogoProps) {
  return (
    <motion.svg
      width={size}
      height={typeof size === "number" ? size * 1.6 : size}
      viewBox="0 0 100 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("overflow-visible", className)}
    >
      <defs>
        <linearGradient id="shimmer-grad-desktop" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="50%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>

        <mask id="logo-mask-desktop">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M50 160C72.0914 160 90 142.091 90 120C90 97.9086 72.0914 80 50 80C27.9086 80 10 97.9086 10 120C10 142.091 27.9086 160 50 160ZM50 142C62.1503 142 72 132.15 72 120C72 107.85 62.1503 98 50 98C37.8497 98 28 107.85 28 120C28 132.15 37.8497 142 50 142Z" fill="white"/>
          <path d="M42 82H58V50C58 45.5817 54.4183 42 50 42C45.5817 42 42 45.5817 42 50V82Z" fill="white"/>
          <path d="M25 45C25 49.4183 28.5817 53 33 53H67C71.4183 53 75 49.4183 75 45V15C75 10.5817 71.4183 7 67 7C62.5817 7 59 10.5817 59 15V40H41V15C41 10.5817 37.4183 7 33 7C28.5817 7 25 10.5817 25 15V45Z" fill="white"/>
          <rect x="42" y="7" width="16" height="35" rx="8" fill="white"/>
        </mask>

        <linearGradient id="logo-fill-desktop" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.85" />
        </linearGradient>

        <filter id="high-glow-desktop" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <g style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))" }}>
        <path 
          fill-rule="evenodd" 
          clip-rule="evenodd" 
          d="M50 160C72.0914 160 90 142.091 90 120C90 97.9086 72.0914 80 50 80C27.9086 80 10 97.9086 10 120C10 142.091 27.9086 160 50 160ZM50 142C62.1503 142 72 132.15 72 120C72 107.85 62.1503 98 50 98C37.8497 98 28 107.85 28 120C28 132.15 37.8497 142 50 142Z" 
          fill="url(#logo-fill-desktop)"
        />
        <path d="M42 82H58V50C58 45.5817 54.4183 42 50 42C45.5817 42 42 45.5817 42 50V82Z" fill="url(#logo-fill-desktop)" />
        <path d="M25 45C25 49.4183 28.5817 53 33 53H67C71.4183 53 75 49.4183 75 45V15C75 10.5817 71.4183 7 67 7C62.5817 7 59 10.5817 59 15V40H41V15C41 10.5817 37.4183 7 33 7C28.5817 7 25 10.5817 25 15V45Z" fill="url(#logo-fill-desktop)" />
        <rect x="42" y="7" width="16" height="35" rx="8" fill="url(#logo-fill-desktop)" />
      </g>

      {animate && (
        <>
          <motion.circle
            cx="50"
            cy="120"
            r="44"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="40 240"
            initial={{ rotate: 0 }}
            animate={{ rotate: 360 }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "linear"
            }}
            style={{ 
              transformOrigin: "50px 120px",
              filter: "url(#high-glow-desktop)"
            }}
          />

          <motion.circle
            cx="50"
            cy="120"
            r="38"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="60 180"
            initial={{ rotate: 360 }}
            animate={{ rotate: 0 }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "linear"
            }}
            style={{ 
              transformOrigin: "50px 120px",
              opacity: 0.8
            }}
          />

          <g mask="url(#logo-mask-desktop)">
            <motion.rect
              x="-100"
              y="-100"
              width="300"
              height="150"
              fill="url(#shimmer-grad-desktop)"
              initial={{ rotate: -45, y: -250 }}
              animate={{ y: 450 }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "linear",
                repeatDelay: 0.5,
              }}
            />
          </g>
        </>
      )}
    </motion.svg>
  );
}
