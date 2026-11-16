import { jsPDF } from 'jspdf';

export function formatTotal(value) {
  const digits = String(value).padStart(3, '0');
  return 'R$ ' + digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + digits.slice(-2);
}

export function proposalPdf(proposal, images = []) {
  const doc = new jsPDF({ format: 'a4', compress: true });
  const c = proposal.content;
  const accent = /^#[\da-f]{6}$/i.test(c.accent) ? c.accent : '#475E71';
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  doc.setProperties({ title: 'Proposta ' + c.code, author: c.company });
  let y = 0;
  function header() {
    doc.setFillColor(accent).rect(0, 0, 210, 5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor('#303A43');
    doc.text(c.code + '  /  v' + proposal.version, 18, 17);
    y = 31;
  }
  function room(height) {
    if (y + height <= 276) return;
    doc.addPage();
    header();
  }
  function paragraph(value, size, bold = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor('#242A30');
    const height = size * 0.46;
    for (const line of doc.splitTextToSize(String(value), 174)) {
      room(height);
      doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor('#242A30');
      doc.text(line, 18, y);
      y += height;
    }
    y += 4;
  }
  function section(label, value) {
    room(22);
    paragraph(label, 10, true);
    paragraph(value, 11);
  }
  header();
  paragraph(c.company, 13, true);
  paragraph(c.title, 24, true);
  section('PREPARADO PARA', c.customer);
  if (c.eventDate) section('EVENTO', c.eventDate.split('-').reverse().join('/') + '  |  ' + c.location);
  section('DECORAÇÃO', c.decoration);
  section('VALOR TOTAL', formatTotal(c.total));
  section('CONDIÇÕES DE PAGAMENTO', c.payment);
  section('VÁLIDA ATÉ', date.format(new Date(proposal.expiresAt)) + ' (horário de Brasília)');
  for (const [index, image] of images.entries()) {
    const { width, height } = doc.getImageProperties(image);
    const scale = Math.min(174 / width, 105 / height);
    room(height * scale + 19);
    paragraph('REFERÊNCIA ' + (index + 1), 10, true);
    doc.addImage(image, 'JPEG', 18, y, width * scale, height * scale, undefined, 'FAST');
    y += height * scale + 12;
  }
  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page).setFont('helvetica', 'normal').setFontSize(9).setTextColor('#475E71');
    doc.text('Proposta comercial', 18, 287);
    doc.text(page + ' / ' + count, 192, 287, { align: 'right' });
  }
  return doc.output('arraybuffer');
}
