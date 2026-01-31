'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, ChevronRight, Filter, Download, Plus, Calendar, MapPin, Grid, BarChart3, MoreVertical, Trash2 } from 'lucide-react';
import { Button, Badge, Card, Input, Select } from '@/components/ui';

interface Scan {
    id: string;
    keyword: string;
    status: string;
    gridSize: number;
    radius: number;
    frequency: string;
    createdAt: string | Date;
    centerLat: number;
    centerLng: number;
}

export default function ScansPage({ initialScans }: { initialScans: Scan[] }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortBy, setSortBy] = useState('newest');

    const filteredScans = useMemo(() => {
        return initialScans
            .filter(scan => {
                const matchesSearch = scan.keyword.toLowerCase().includes(searchQuery.toLowerCase());
                const matchesStatus = statusFilter === 'all' || scan.status.toLowerCase() === statusFilter.toLowerCase();
                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => {
                if (sortBy === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                if (sortBy === 'keyword') return a.keyword.localeCompare(b.keyword);
                return 0;
            });
    }, [initialScans, searchQuery, statusFilter, sortBy]);

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                            <MapPin size={20} />
                        </div>
                        <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight">Rank Tracker</h1>
                    </div>
                    <p className="text-xs text-gray-500 font-bold ml-1 uppercase tracking-widest opacity-70">Spatial Intelligence Grid Network</p>
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" className="h-11 px-5 border-gray-200 hover:bg-gray-50 hover:text-blue-600 transition-all font-bold">
                        <Download className="mr-2 w-4 h-4" /> Export All
                    </Button>
                    <Link href="/scans/new">
                        <Button className="h-11 px-6 bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/20 font-black uppercase text-xs tracking-widest">
                            <Plus className="mr-2 w-4 h-4" /> New Ranking Report
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Filters & Search - Re-designed for Premium Feel */}
            <Card className="p-1.5 flex flex-col lg:flex-row gap-2 border-none shadow-xl ring-1 ring-gray-200 bg-white/80 backdrop-blur-md">
                <div className="flex-1 relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors">
                        <Search size={18} />
                    </div>
                    <input
                        type="text"
                        placeholder="Search keywords, points, or status..."
                        className="w-full h-12 pl-12 pr-4 bg-gray-50/50 rounded-xl border-none outline-none focus:ring-2 focus:ring-blue-500/10 focus:bg-white transition-all font-medium text-gray-900 text-sm placeholder:text-gray-400"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap md:flex-nowrap gap-2">
                    <div className="w-full md:w-44">
                        <select
                            className="w-full h-12 px-4 bg-gray-50/50 rounded-xl border-none outline-none focus:ring-2 focus:ring-blue-500/10 focus:bg-white transition-all font-bold text-gray-700 text-xs uppercase tracking-wider cursor-pointer appearance-none"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1rem' }}
                        >
                            <option value="all">All Statuses</option>
                            <option value="running">Running</option>
                            <option value="completed">Completed</option>
                            <option value="stopped">Stopped</option>
                            <option value="pending">Pending</option>
                            <option value="failed">Failed</option>
                        </select>
                    </div>

                    <div className="w-full md:w-44">
                        <select
                            className="w-full h-12 px-4 bg-gray-50/50 rounded-xl border-none outline-none focus:ring-2 focus:ring-blue-500/10 focus:bg-white transition-all font-bold text-gray-700 text-xs uppercase tracking-wider cursor-pointer appearance-none"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1rem' }}
                        >
                            <option value="newest">Newest First</option>
                            <option value="oldest">Oldest First</option>
                            <option value="keyword">Alphabetical</option>
                        </select>
                    </div>
                </div>
            </Card>

            {/* Data Grid View */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredScans.length === 0 ? (
                    <div className="col-span-full py-32 flex flex-col items-center justify-center bg-white rounded-3xl border-2 border-dashed border-gray-100 text-center">
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-gray-100">
                            <Search size={32} className="text-gray-300" />
                        </div>
                        <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">No Reports Found</h3>
                        <p className="text-gray-400 mt-2 max-w-xs mx-auto text-sm font-medium leading-relaxed">
                            Try adjusting your search query or create a new tracking report to start monitoring.
                        </p>
                    </div>
                ) : (
                    filteredScans.map((scan) => (
                        <Card key={scan.id} noPadding className="group overflow-hidden border-none shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 ring-1 ring-gray-200 hover:ring-blue-500/30">
                            <Link href={`/scans/${scan.id}`} className="block h-full">
                                <div className="p-6 h-full flex flex-col">
                                    <div className="flex justify-between items-start mb-4">
                                        <Badge variant={
                                            scan.status === 'COMPLETED' ? 'success' :
                                                scan.status === 'RUNNING' ? 'blue' :
                                                    'default'
                                        } className="font-black text-[10px] uppercase tracking-widest px-2.5 py-0.5 shadow-sm">
                                            {scan.status}
                                        </Badge>
                                        <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 group-hover:bg-blue-50 group-hover:text-blue-500 transition-all shadow-inner">
                                            <ChevronRight size={16} />
                                        </div>
                                    </div>

                                    <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-blue-600 transition-colors leading-tight line-clamp-2">
                                        {scan.keyword}
                                    </h3>

                                    <div className="space-y-3 mt-auto border-t border-gray-50 pt-4">
                                        <div className="flex items-center text-xs text-gray-500 font-medium">
                                            <Calendar size={12} className="mr-2 text-blue-500" />
                                            {new Date(scan.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </div>
                                        <div className="flex items-center text-xs text-gray-500 font-medium">
                                            <MapPin size={12} className="mr-2 text-blue-500" />
                                            <span className="truncate">{scan.centerLat.toFixed(4)}, {scan.centerLng.toFixed(4)}</span>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs">
                                            <div className="flex items-center text-gray-700 font-bold bg-gray-100 px-2 py-1 rounded-md">
                                                <Grid size={12} className="mr-1.5 opacity-50" />
                                                {scan.gridSize}x{scan.gridSize}
                                            </div>
                                            <div className="flex items-center text-gray-700 font-bold bg-gray-100 px-2 py-1 rounded-md">
                                                <BarChart3 size={12} className="mr-1.5 opacity-50" />
                                                {scan.radius}km
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
