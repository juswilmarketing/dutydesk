import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_MM = 10;

function waitForRender(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Render HTML to a PDF blob (client-side). */
export async function generateHtmlPdf(html: string, width = 720): Promise<Blob> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = `${width}px`;
  iframe.style.height = "800px";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error("Could not prepare PDF renderer");
  }

  try {
    doc.open();
    doc.write(html);
    doc.close();
    await waitForRender();

    const contentHeight = Math.max(
      doc.body.scrollHeight,
      doc.documentElement.scrollHeight,
      doc.body.offsetHeight,
      400,
    );
    iframe.style.height = `${contentHeight}px`;
    await waitForRender(150);

    const canvas = await html2canvas(doc.body, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      width,
      height: contentHeight,
      windowWidth: width,
      windowHeight: contentHeight,
      scrollY: 0,
      scrollX: 0,
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const printableWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
    const printableHeight = PAGE_HEIGHT_MM - MARGIN_MM * 2;
    const imgWidth = printableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = MARGIN_MM;
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    pdf.addImage(imgData, "JPEG", MARGIN_MM, position, imgWidth, imgHeight);
    heightLeft -= printableHeight;

    while (heightLeft > 0) {
      position = MARGIN_MM - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", MARGIN_MM, position, imgWidth, imgHeight);
      heightLeft -= printableHeight;
    }

    return pdf.output("blob");
  } finally {
    document.body.removeChild(iframe);
  }
}

/** @deprecated Use generateHtmlPdf */
export const generateTaxAdvicePdf = generateHtmlPdf;

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function htmlToPdfBase64(html: string, width = 720): Promise<string> {
  return blobToBase64(await generateHtmlPdf(html, width));
}

export function downloadPdfBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function downloadHtmlAsPdf(html: string, filename: string, width = 720) {
  const blob = await generateHtmlPdf(html, width);
  downloadPdfBlob(blob, filename);
}
