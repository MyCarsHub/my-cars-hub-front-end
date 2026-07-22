import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { ReportsOverviewResponse } from '../types/reports.types';

function centsToBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1).replace('.', ',')}%`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtYearMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${names[parseInt(m, 10) - 1]}/${y.slice(2)}`;
}

/**
 * Baixa um arquivo blob local sem depender de file-saver.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportReportPdf(report: ReportsOverviewResponse): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const period = `${fmtDate(report.from)} — ${fmtDate(report.to)}`;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Relatório MyCarsHub', 40, 50);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90);
  doc.text(`Período: ${period}`, 40, 68);

  // Financeiro
  autoTable(doc, {
    startY: 90,
    head: [['Financeiro', 'Valor']],
    body: [
      ['Receita recebida', centsToBRL(report.financial.grossRevenueCents)],
      ['Receita a receber (previsto)', centsToBRL(report.financial.accruedRevenueCents)],
      ['Custo operacional', centsToBRL(report.financial.operatingCostCents)],
      ['Lucro líquido', centsToBRL(report.financial.netProfitCents)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [235, 63, 0] },
    styles: { fontSize: 10 },
  });

  // Receita por gateway
  if (report.financial.revenueByGateway.length > 0) {
    autoTable(doc, {
      head: [['Gateway', 'Receita']],
      body: report.financial.revenueByGateway.map((g) => [g.provider, centsToBRL(g.amountCents)]),
      theme: 'grid',
      headStyles: { fillColor: [235, 63, 0] },
      styles: { fontSize: 10 },
    });
  }

  // Operação
  autoTable(doc, {
    head: [['Operação', 'Valor']],
    body: [
      ['Aluguéis ativos', String(report.operations.activeRentalsCount)],
      ['Aluguéis concluídos', String(report.operations.completedRentalsCount)],
      ['Aluguéis cancelados', String(report.operations.canceledRentalsCount)],
      ['Taxa de ocupação da frota', pct(report.operations.fleetOccupancyRate)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [235, 63, 0] },
    styles: { fontSize: 10 },
  });

  // Veículos lucrativos
  if (report.vehicleRanking.topProfitable.length > 0) {
    autoTable(doc, {
      head: [['Top 5 veículos lucrativos', 'Receita', 'Custo', 'Líquido']],
      body: report.vehicleRanking.topProfitable.map((v) => [
        v.plate,
        centsToBRL(v.revenueCents),
        centsToBRL(v.costCents),
        centsToBRL(v.netCents),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [22, 163, 74] },
      styles: { fontSize: 10 },
    });
  }

  // Veículos com prejuízo
  if (report.vehicleRanking.topUnprofitable.length > 0) {
    autoTable(doc, {
      head: [['Top 5 veículos com prejuízo', 'Receita', 'Custo', 'Líquido']],
      body: report.vehicleRanking.topUnprofitable.map((v) => [
        v.plate,
        centsToBRL(v.revenueCents),
        centsToBRL(v.costCents),
        centsToBRL(v.netCents),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [190, 18, 60] },
      styles: { fontSize: 10 },
    });
  }

  // Motoristas top receita
  if (report.driverRanking.topRevenue.length > 0) {
    autoTable(doc, {
      head: [['Top 5 motoristas por receita', 'Receita']],
      body: report.driverRanking.topRevenue.map((d) => [d.name, centsToBRL(d.revenueCents)]),
      theme: 'grid',
      headStyles: { fillColor: [22, 163, 74] },
      styles: { fontSize: 10 },
    });
  }

  // Motoristas problemáticos
  if (report.driverRanking.topProblematic.length > 0) {
    autoTable(doc, {
      head: [['Top 5 motoristas problemáticos', 'Multas em aberto', 'Charges em aberto', 'Total']],
      body: report.driverRanking.topProblematic.map((d) => [
        d.name,
        centsToBRL(d.unpaidFinesCents),
        centsToBRL(d.unpaidChargesCents),
        centsToBRL(d.totalProblematicCents),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [190, 18, 60] },
      styles: { fontSize: 10 },
    });
  }

  // Receita mensal
  if (report.financial.monthlyRevenue.length > 0) {
    autoTable(doc, {
      head: [['Mês', 'Receita']],
      body: report.financial.monthlyRevenue.map((m) => [fmtYearMonth(m.yearMonth), centsToBRL(m.revenueCents)]),
      theme: 'grid',
      headStyles: { fillColor: [235, 63, 0] },
      styles: { fontSize: 10 },
    });
  }

  const filename = `relatorio-mycarshub-${report.from}_${report.to}.pdf`;
  doc.save(filename);
}

export function exportReportExcel(report: ReportsOverviewResponse): void {
  const wb = XLSX.utils.book_new();

  const financialRows = [
    ['Período', `${fmtDate(report.from)} — ${fmtDate(report.to)}`],
    [],
    ['Financeiro', 'Valor (R$)'],
    ['Receita recebida', (report.financial.grossRevenueCents ?? 0) / 100],
    ['Receita a receber (previsto)', (report.financial.accruedRevenueCents ?? 0) / 100],
    ['Custo operacional', (report.financial.operatingCostCents ?? 0) / 100],
    ['Lucro líquido', (report.financial.netProfitCents ?? 0) / 100],
    [],
    ['Gateway', 'Receita (R$)'],
    ...report.financial.revenueByGateway.map((g) => [g.provider, g.amountCents / 100]),
    [],
    ['Operação', 'Valor'],
    ['Aluguéis ativos', report.operations.activeRentalsCount],
    ['Aluguéis concluídos', report.operations.completedRentalsCount],
    ['Aluguéis cancelados', report.operations.canceledRentalsCount],
    ['Taxa de ocupação da frota (%)', +(report.operations.fleetOccupancyRate * 100).toFixed(2)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(financialRows), 'Resumo');

  if (report.vehicleRanking.topProfitable.length > 0 || report.vehicleRanking.topUnprofitable.length > 0) {
    const rows: (string | number)[][] = [];
    rows.push(['Top veículos lucrativos']);
    rows.push(['Placa', 'Receita (R$)', 'Custo (R$)', 'Líquido (R$)']);
    for (const v of report.vehicleRanking.topProfitable) {
      rows.push([v.plate, v.revenueCents / 100, v.costCents / 100, v.netCents / 100]);
    }
    rows.push([]);
    rows.push(['Top veículos com prejuízo']);
    rows.push(['Placa', 'Receita (R$)', 'Custo (R$)', 'Líquido (R$)']);
    for (const v of report.vehicleRanking.topUnprofitable) {
      rows.push([v.plate, v.revenueCents / 100, v.costCents / 100, v.netCents / 100]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Veículos');
  }

  if (report.driverRanking.topRevenue.length > 0 || report.driverRanking.topProblematic.length > 0) {
    const rows: (string | number)[][] = [];
    rows.push(['Top motoristas por receita']);
    rows.push(['Nome', 'Receita (R$)']);
    for (const d of report.driverRanking.topRevenue) {
      rows.push([d.name, d.revenueCents / 100]);
    }
    rows.push([]);
    rows.push(['Top motoristas problemáticos']);
    rows.push(['Nome', 'Multas em aberto (R$)', 'Charges em aberto (R$)', 'Total (R$)']);
    for (const d of report.driverRanking.topProblematic) {
      rows.push([
        d.name,
        d.unpaidFinesCents / 100,
        d.unpaidChargesCents / 100,
        d.totalProblematicCents / 100,
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Motoristas');
  }

  if (report.financial.monthlyRevenue.length > 0) {
    const rows: (string | number)[][] = [['Mês', 'Receita (R$)']];
    for (const m of report.financial.monthlyRevenue) {
      rows.push([fmtYearMonth(m.yearMonth), m.revenueCents / 100]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Receita mensal');
  }

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const filename = `relatorio-mycarshub-${report.from}_${report.to}.xlsx`;
  downloadBlob(new Blob([wbout], { type: 'application/octet-stream' }), filename);
}

export function reportToMarkdown(report: ReportsOverviewResponse): string {
  const lines: string[] = [];
  lines.push(`# Relatório MyCarsHub`);
  lines.push('');
  lines.push(`**Período:** ${fmtDate(report.from)} — ${fmtDate(report.to)}`);
  lines.push('');
  lines.push(`## Financeiro`);
  lines.push('');
  lines.push(`- **Receita recebida:** ${centsToBRL(report.financial.grossRevenueCents)}`);
  lines.push(`- **Receita a receber (previsto):** ${centsToBRL(report.financial.accruedRevenueCents)}`);
  lines.push(`- **Custo operacional:** ${centsToBRL(report.financial.operatingCostCents)}`);
  lines.push(`- **Lucro líquido:** ${centsToBRL(report.financial.netProfitCents)}`);
  lines.push('');

  if (report.financial.revenueByGateway.length > 0) {
    lines.push(`### Receita por gateway`);
    lines.push('');
    lines.push('| Gateway | Receita |');
    lines.push('|---|---|');
    for (const g of report.financial.revenueByGateway) {
      lines.push(`| ${g.provider} | ${centsToBRL(g.amountCents)} |`);
    }
    lines.push('');
  }

  lines.push(`## Operação`);
  lines.push('');
  lines.push(`- **Aluguéis ativos:** ${report.operations.activeRentalsCount}`);
  lines.push(`- **Aluguéis concluídos:** ${report.operations.completedRentalsCount}`);
  lines.push(`- **Aluguéis cancelados:** ${report.operations.canceledRentalsCount}`);
  lines.push(`- **Taxa de ocupação da frota:** ${pct(report.operations.fleetOccupancyRate)}`);
  lines.push('');

  if (report.vehicleRanking.topProfitable.length > 0) {
    lines.push(`## Top veículos lucrativos`);
    lines.push('');
    lines.push('| Placa | Receita | Custo | Líquido |');
    lines.push('|---|---|---|---|');
    for (const v of report.vehicleRanking.topProfitable) {
      lines.push(`| ${v.plate} | ${centsToBRL(v.revenueCents)} | ${centsToBRL(v.costCents)} | ${centsToBRL(v.netCents)} |`);
    }
    lines.push('');
  }

  if (report.vehicleRanking.topUnprofitable.length > 0) {
    lines.push(`## Top veículos com prejuízo`);
    lines.push('');
    lines.push('| Placa | Receita | Custo | Líquido |');
    lines.push('|---|---|---|---|');
    for (const v of report.vehicleRanking.topUnprofitable) {
      lines.push(`| ${v.plate} | ${centsToBRL(v.revenueCents)} | ${centsToBRL(v.costCents)} | ${centsToBRL(v.netCents)} |`);
    }
    lines.push('');
  }

  if (report.driverRanking.topRevenue.length > 0) {
    lines.push(`## Top motoristas por receita`);
    lines.push('');
    lines.push('| Nome | Receita |');
    lines.push('|---|---|');
    for (const d of report.driverRanking.topRevenue) {
      lines.push(`| ${d.name} | ${centsToBRL(d.revenueCents)} |`);
    }
    lines.push('');
  }

  if (report.driverRanking.topProblematic.length > 0) {
    lines.push(`## Top motoristas problemáticos`);
    lines.push('');
    lines.push('| Nome | Multas abertas | Charges abertas | Total |');
    lines.push('|---|---|---|---|');
    for (const d of report.driverRanking.topProblematic) {
      lines.push(`| ${d.name} | ${centsToBRL(d.unpaidFinesCents)} | ${centsToBRL(d.unpaidChargesCents)} | ${centsToBRL(d.totalProblematicCents)} |`);
    }
    lines.push('');
  }

  if (report.financial.monthlyRevenue.length > 0) {
    lines.push(`## Receita mensal`);
    lines.push('');
    lines.push('| Mês | Receita |');
    lines.push('|---|---|');
    for (const m of report.financial.monthlyRevenue) {
      lines.push(`| ${fmtYearMonth(m.yearMonth)} | ${centsToBRL(m.revenueCents)} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('_Gerado por MyCarsHub. Cole este relatório em qualquer IA (ChatGPT, Claude, Gemini) para análise, insights ou plano de ação._');

  return lines.join('\n');
}
