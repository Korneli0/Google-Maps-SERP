import { ExternalLink, MapPin } from 'lucide-react';

interface BusinessCardProps {
    biz: {
        name: string;
        rank: number;
        rating?: number;
        reviews?: number;
        address?: string;
        url?: string;
    };
    scan: {
        businessName?: string;
    };
    compact?: boolean;
}

export function BusinessCard({ biz, scan, compact = false }: BusinessCardProps) {
    return (
        <a
            href={biz.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className={`
                group block bg-white rounded-xl ring-1 ring-gray-200 hover:ring-blue-500/50 hover:shadow-md transition-all relative overflow-hidden
                ${compact ? 'p-2.5' : 'p-4'}
                ${scan.businessName && biz.name.toLowerCase().includes(scan.businessName.toLowerCase()) ? 'ring-2 ring-blue-600 ring-offset-2' : ''}
            `}
        >
            {/* Card Header */}
            <div className="flex items-start justify-between mb-1.5">
                <span className={`
                    rounded-lg font-black flex items-center justify-center shrink-0
                    ${compact ? 'text-[9px] px-1.5 py-0.5 h-6 min-w-[1.5rem]' : 'w-7 h-7 text-xs'}
                    ${biz.rank <= 3 ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20' : 'bg-gray-100 text-gray-500'}
                `}>
                    #{biz.rank}
                </span>
                <ExternalLink size={compact ? 12 : 14} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
            </div>

            {/* Business Name */}
            <p className={`
                font-black text-gray-900 group-hover:text-blue-600 transition-colors leading-tight uppercase line-clamp-2
                ${compact ? 'text-[11px] mb-2 min-h-[28px]' : 'text-sm mb-2'}
            `}>
                {biz.name}
            </p>

            {/* Ratings */}
            <div className={`flex items-center gap-1.5 ${compact ? 'mb-2' : 'mb-3'}`}>
                <div className="flex items-center gap-0.5 bg-amber-50 px-1.5 py-0.5 rounded text-amber-600 border border-amber-100">
                    <span className="text-[10px] font-black">{biz.rating || '0.0'}</span>
                    <span className="text-[8px]">★</span>
                </div>
                <span className="text-[10px] text-gray-400 font-bold">({biz.reviews || 0} reviews)</span>
            </div>

            {/* Address / SAB */}
            <div className={`flex items-start gap-2 border-t border-gray-50 ${compact ? 'pt-2' : 'pt-3 mt-auto'}`}>
                <MapPin size={10} className="text-blue-500/60 shrink-0 mt-0.5" />
                <span className="text-[10px] text-gray-500 font-medium truncate uppercase">
                    {biz.address ? biz.address : 'Service Area Business'}
                </span>
            </div>

            {/* Target Account Badge */}
            {scan.businessName && biz.name.toLowerCase().includes(scan.businessName.toLowerCase()) && !compact && (
                <div className="mt-3 bg-blue-600 text-[9px] font-black text-white py-1.5 px-3 rounded-xl uppercase tracking-[2px] text-center shadow-lg shadow-blue-500/30">
                    Target Account Linked
                </div>
            )}
        </a>
    );
}
