import React from 'react';

const Tooltip = ({ content, children }: { content: string, children?: React.ReactNode }) => (
    <div className="group relative flex items-center justify-center">
        {children}
        <div className="absolute bottom-full mb-2 hidden group-hover:block px-2.5 py-1.5 bg-zinc-800 text-zinc-100 text-[10px] font-bold tracking-wide rounded-lg whitespace-nowrap z-50 pointer-events-none shadow-xl border border-white/10">
            {content}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800"></div>
        </div>
    </div>
);

export default Tooltip;
