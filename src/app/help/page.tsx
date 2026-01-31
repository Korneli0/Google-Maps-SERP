'use client';

import { Card, Button } from '@/components/ui';
import {
    HelpCircle,
    Zap,
    Map as MapIcon,
    Navigation,
    ChevronRight,
    Play,
    Clock,
    Shield,
    BarChart3
} from 'lucide-react';

const sections = [
    {
        title: "Getting Started",
        icon: Play,
        content: "To start a new scan, click the 'New Report' button in the sidebar. You can choose between a 'Quick Scan' (to see who is ranking for a keyword) or 'Tracker' mode (to see where your specific business ranks)."
    },
    {
        title: "Advanced Grid Features",
        icon: MapIcon,
        content: "We support both Square and Circle grids. You can now also move pins manually on the preview map before starting a scan. Simply click and drag any pin to refine your target area."
    },
    {
        title: "Zip Code Intelligence",
        icon: Navigation,
        content: "Use the 'City Zip Scan' mode to automatically cluster pins around specific zip codes within a city. This is perfect for high-density metropolitan analysis."
    },
    {
        title: "Proxy Support",
        icon: Shield,
        content: "For heavy scanning, we recommend using Residential Proxies. You can configure these in the Settings. We support both free and paid proxy rotations to ensure your server IP stays clean."
    },
    {
        title: "Understanding Schedules",
        icon: Clock,
        content: "Since this app runs on your local machine, scheduled scans (e.g., every 24 hours) will only trigger when the application is running. If you miss a scan while offline, GeoRanker will prompt you to run it the next time you start the app."
    },
    {
        title: "Reports & Analysis",
        icon: BarChart3,
        content: "Every scan generates a deep analysis card. We calculate 'Market Dominance' and 'Share of Voice' based on where your business (or competitors) appear in the Top 3 and Top 10 results."
    },
    {
        title: "Provider Integration",
        icon: Zap,
        content: "To use a premium provider like Bright Data or Smartproxy, go to Settings > Proxies > Manual Entry. Copy your provider's endpoint host, port, and credentials. Ensure you select 'Residential' for the best results."
    }
];

export default function HelpPage() {
    return (
        <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                            <HelpCircle size={20} />
                        </div>
                        <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight">Intelligence Guide</h1>
                    </div>
                    <p className="text-xs text-gray-500 font-bold ml-1 uppercase tracking-widest opacity-70">Comprehensive Spatial Documentation</p>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {sections.map((section) => (
                    <Card key={section.title} className="h-full p-6 hover:shadow-lg transition-all border-none ring-1 ring-gray-100 group">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                <section.icon size={20} />
                            </div>
                            <div className="flex-1 space-y-2">
                                <h3 className="font-bold text-gray-900 flex items-center justify-between">
                                    {section.title}
                                    <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                                </h3>
                                <p className="text-sm text-gray-500 leading-relaxed">
                                    {section.content}
                                </p>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            <Card noPadding className="bg-gradient-to-br from-indigo-900 to-blue-900 text-white border-none shadow-xl shadow-blue-900/20 overflow-hidden relative">
                <div className="p-8 relative z-10 flex flex-col md:flex-row items-center gap-8">
                    <div className="flex-1 space-y-4">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-blue-500/30 rounded-lg backdrop-blur-md">
                                <Zap size={16} className="text-blue-300 fill-blue-300" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-blue-300">Pro Tip</span>
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight">Master the "Smart Grid" Logic</h2>
                        <p className="text-blue-100/100 text-sm leading-relaxed">
                            Our <strong className="text-blue-300 mt-1">Variable Density Engine</strong> prioritizes scan points based on proximity to the center.
                            This allows for ultra-high resolution results where rank fluctuation is most frequent, while covering peripheral zones efficiently.
                        </p>
                        <Button className="bg-white text-blue-900 hover:bg-blue-50 font-bold px-6 border-none">
                            Explore Smart Grids
                        </Button>
                    </div>
                    <div className="w-48 h-48 bg-white/10 rounded-full flex items-center justify-center border border-white/20 backdrop-blur-md">
                        <Navigation size={64} className="text-white opacity-20" />
                    </div>
                </div>
            </Card>
        </div>
    );
}
