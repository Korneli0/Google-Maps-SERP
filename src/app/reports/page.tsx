import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { FileText, Download, TrendingUp, Calendar, MapPin, Search } from 'lucide-react';
import { Card, Button, Badge } from '@/components/ui';

export default async function ReportsPage() {
    const reports = await prisma.scan.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        include: { results: true }
    });

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Reports Library</h1>
                    <p className="text-gray-500 mt-1">Access and download your historical ranking reports.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {reports.length === 0 ? (
                    <div className="col-span-3 py-16 text-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        <FileText size={48} className="mx-auto mb-4 opacity-20" />
                        <h3 className="text-lg font-medium text-gray-900">No reports generated yet</h3>
                        <p className="text-sm mt-1 mb-6">Completed scans will appear here for download.</p>
                        <Link href="/scans/new">
                            <Button>Start New Scan</Button>
                        </Link>
                    </div>
                ) : (
                    reports.map(report => {
                        const completedPoints = report.results.length;
                        const top3Count = report.results.filter(r => r.rank && r.rank <= 3).length;
                        const visibility = completedPoints > 0 ? Math.round((top3Count / completedPoints) * 100) : 0;

                        return (
                            <Card key={report.id} className="flex flex-col h-full hover:shadow-md transition-shadow">
                                <div className="p-6 flex-1">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                            <FileText size={20} />
                                        </div>
                                        <Badge variant="success">Ready</Badge>
                                    </div>

                                    <h3 className="text-lg font-bold text-gray-900 mb-1">{report.keyword}</h3>
                                    <p className="text-sm text-gray-500 flex items-center gap-1 mb-4">
                                        <MapPin size={12} />
                                        {report.centerLat.toFixed(3)}, {report.centerLng.toFixed(3)}
                                    </p>

                                    <div className="space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Scan Date</span>
                                            <span className="font-medium">{new Date(report.createdAt).toLocaleDateString()}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Grid Size</span>
                                            <span className="font-medium">{report.gridSize}x{report.gridSize}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Visibility Score</span>
                                            <span className="font-bold text-emerald-600">{visibility}%</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
                                    <Link href={`/scans/${report.id}`} className="flex-1">
                                        <Button variant="outline" className="w-full">View</Button>
                                    </Link>
                                    <Button variant="ghost" size="icon" title="Download CSV">
                                        <Download size={18} className="text-gray-500" />
                                    </Button>
                                </div>
                            </Card>
                        );
                    })
                )}
            </div>
        </div>
    );
}
