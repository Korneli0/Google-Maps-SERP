import { Card, Badge } from '@/components/ui';
import { Store, MapPin, List, Activity, Target } from 'lucide-react';
import { BusinessCard } from '@/components/scans/BusinessCard';

interface PinInspectionSidebarProps {
    selectedPoint: any;
    getTopResults: (jsonStr: string) => any[];
    scan: any;
}

export function PinInspectionSidebar({ selectedPoint, getTopResults, scan }: PinInspectionSidebarProps) {
    return (
        <div className="sticky top-6">
            <Card noPadding className="h-[85vh] flex flex-col p-0 overflow-hidden shadow-xl ring-1 ring-gray-200 border-none">
                <div className="p-2.5 border-b border-gray-100 bg-blue-600 text-white shrink-0 z-20 relative">
                    <h3 className="font-bold flex items-center gap-2">
                        <Store size={18} />
                        Pin Inspection
                    </h3>
                    <p className="text-[10px] text-blue-100 mt-1 uppercase font-bold tracking-widest">Deep coordinate analysis</p>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto bg-white relative">
                    {selectedPoint ? (
                        <div className="p-3 space-y-4 pb-24">
                            <div className="flex justify-between items-center bg-indigo-50 p-3 rounded-xl border border-indigo-100 shadow-sm relative overflow-hidden">
                                <div className="relative z-10">
                                    <p className="text-[9px] text-indigo-600 font-black uppercase tracking-[2px] mb-0.5">Target Rank</p>
                                    <p className="text-2xl font-black text-indigo-900 tracking-tighter">#{selectedPoint.rank ?? '-'}</p>
                                </div>
                                <div className="text-right relative z-10">
                                    <p className="text-[9px] text-indigo-400 font-black uppercase tracking-widest mb-1">Geospatial Data</p>
                                    <p className="text-[10px] font-black text-indigo-800 font-mono tracking-tighter bg-white/50 px-1.5 py-0.5 rounded-md">{selectedPoint.lat.toFixed(6)}</p>
                                    <p className="text-[10px] font-black text-indigo-800 font-mono tracking-tighter bg-white/50 px-1.5 py-0.5 rounded-md mt-1">{selectedPoint.lng.toFixed(6)}</p>
                                </div>
                                <div className="absolute -left-2 -bottom-2 opacity-[0.05] text-indigo-900 pointer-events-none">
                                    <MapPin size={50} />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-1">
                                    <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-[3px] flex items-center gap-2">
                                        <List size={12} className="text-blue-600" />
                                        Point Specific SERP
                                    </h4>
                                    <Badge variant="blue" className="font-black text-[9px] uppercase tracking-widest bg-blue-600 text-white border-none">{getTopResults(selectedPoint.topResults).length} Detected</Badge>
                                </div>

                                <div className="space-y-3">
                                    {getTopResults(selectedPoint.topResults).length > 0 ? (
                                        getTopResults(selectedPoint.topResults).map((biz, idx) => (
                                            <BusinessCard
                                                key={idx}
                                                biz={biz}
                                                scan={scan}
                                                compact={true}
                                            />
                                        ))
                                    ) : (
                                        <div className="py-24 text-center">
                                            <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4 ring-1 ring-gray-100">
                                                <Activity className="text-gray-200" size={32} />
                                            </div>
                                            <p className="text-[11px] font-black uppercase tracking-[3px] text-gray-300">Analysis Pending</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center p-12 text-center text-gray-400">
                            <div className="w-24 h-24 rounded-[2rem] bg-gray-50 flex items-center justify-center mb-8 shadow-inner ring-1 ring-gray-100">
                                <Target size={48} className="opacity-[0.05]" />
                            </div>
                            <h4 className="text-[12px] font-black uppercase tracking-[4px] text-gray-500 mb-3">Spatial Inspection</h4>
                            <p className="text-[11px] leading-relaxed max-w-[260px] font-medium text-gray-400/80">
                                Select any grid coordinate on the map to initialize a deep-dive SERP inspection.
                            </p>
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
}
