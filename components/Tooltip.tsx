import React from 'react';

interface TooltipProps {
    text: string;
    children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ text, children }) => (
  <span className="relative group inline-flex items-center">
    {children}
    <span className="absolute z-50 hidden group-hover:block group-focus-within:block top-full mt-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] leading-snug px-2 py-1 rounded shadow max-w-[280px] whitespace-normal break-words text-left" role="tooltip">
      {text}
    </span>
  </span>
);

export default Tooltip;
