import { useState, useRef, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  children: ReactNode;
}

export default function Tooltip({ label, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    timerRef.current = setTimeout(() => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      setPos({ x: r.left + r.width / 2, y: r.top - 8 });
      setVisible(true);
    }, 320);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={hide} style={{ display: "inline-flex" }}>
      {children}
      {visible && createPortal(
        <div style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          transform: "translateX(-50%) translateY(-100%)",
          background: "rgba(26,26,26,0.97)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.82)",
          fontSize: 11,
          fontWeight: 450,
          fontFamily: "var(--font-sans)",
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          padding: "4px 9px",
          borderRadius: 7,
          pointerEvents: "none",
          zIndex: 99999,
          boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
          animation: "tooltipIn 0.14s cubic-bezier(0.16,1,0.3,1) both",
        }}>
          {label}
        </div>,
        document.body
      )}
    </div>
  );
}
