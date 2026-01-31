import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export async function exportToXLSX(scanName: string, data: any[]) {
    const workbook = new ExcelJS.Workbook();
    addScanToWorkbook(workbook, scanName, data);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scanName.replace(/\s+/g, '_')}_results.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function addScanToWorkbook(workbook: ExcelJS.Workbook, scanName: string, data: any[]) {
    const sheetName = scanName.substring(0, 31).replace(/[\\\/\?\*\[\]]/g, '_');
    const worksheet = workbook.addWorksheet(sheetName);

    worksheet.columns = [
        { header: 'Rank', key: 'rank', width: 10 },
        { header: 'Business Name', key: 'name', width: 40 },
        { header: 'Rating', key: 'rating', width: 10 },
        { header: 'Reviews', key: 'reviews', width: 10 },
        { header: 'Address', key: 'address', width: 60 },
        { header: 'URL', key: 'url', width: 80 },
        { header: 'Point Lat', key: 'lat', width: 15 },
        { header: 'Point Lng', key: 'lng', width: 15 },
    ];

    data.forEach(point => {
        try {
            const results = JSON.parse(point.topResults);
            results.forEach((res: any) => {
                worksheet.addRow({
                    rank: res.rank,
                    name: res.name,
                    rating: res.rating || 'N/A',
                    reviews: res.reviews || 0,
                    address: res.address || '',
                    url: res.url || '',
                    lat: point.lat,
                    lng: point.lng
                });
            });
        } catch (e) {
            console.error('Failed to parse results for excel export', e);
        }
    });
}

export async function exportAllScansToXLSX(scans: any[]) {
    const workbook = new ExcelJS.Workbook();

    // Summary sheet first
    const summarySheet = workbook.addWorksheet('All Scans Summary');
    summarySheet.columns = [
        { header: 'Keyword', key: 'keyword', width: 30 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Grid Size', key: 'gridSize', width: 10 },
        { header: 'Radius', key: 'radius', width: 10 },
        { header: 'Created At', key: 'createdAt', width: 25 },
        { header: 'Center Lat', key: 'centerLat', width: 15 },
        { header: 'Center Lng', key: 'centerLng', width: 15 },
    ];

    scans.forEach(scan => {
        summarySheet.addRow({
            keyword: scan.keyword,
            status: scan.status,
            gridSize: `${scan.gridSize}x${scan.gridSize}`,
            radius: `${scan.radius}km`,
            createdAt: new Date(scan.createdAt).toLocaleString(),
            centerLat: scan.centerLat,
            centerLng: scan.centerLng
        });

        if (scan.results && scan.results.length > 0) {
            addScanToWorkbook(workbook, scan.keyword, scan.results);
        }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GeoRanker_All_Scans_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
}

export async function exportToPDF(scanName: string, data: any[]) {
    const doc = new jsPDF();

    doc.setFontSize(20);
    doc.text(`GeoRanker Report: ${scanName}`, 14, 22);

    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);

    const tableData: any[][] = [];
    data.forEach(point => {
        try {
            const results = JSON.parse(point.topResults);
            results.forEach((res: any) => {
                tableData.push([
                    res.rank,
                    res.name,
                    `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
                    res.address || ''
                ]);
            });
        } catch (e) { }
    });

    autoTable(doc, {
        head: [['Rank', 'Business', 'Coordinate', 'Address']],
        body: tableData,
        startY: 35,
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] },
        styles: { fontSize: 8 }
    });

    doc.save(`${scanName.replace(/\s+/g, '_')}_report.pdf`);
}
