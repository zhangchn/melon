/**
 * PDF Renderer Utility
 * Renders PDF first page to canvas using pdf.js
 */

import * as pdfjsLib from '../lib/pdfjs/build/pdf.mjs';

// Set worker path - relative to web root
pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdfjs/build/pdf.worker.mjs';

/**
 * Render the first page of a PDF to a canvas
 * @param {string} url - URL to the PDF file
 * @param {HTMLCanvasElement} canvas - Canvas element to render to
 * @param {number} scale - Scale factor (default 0.5 for thumbnail)
 * @returns {Promise<number>} - Number of pages in the PDF
 */
export async function renderPdfFirstPage(url, canvas, scale = 0.5) {
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    
    // Get first page
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    
    // Set canvas dimensions
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Render page to canvas
    const context = canvas.getContext('2d');
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Return total page count
    return pdf.numPages;
  } catch (error) {
    console.error('Error rendering PDF:', error);
    throw error;
  }
}

/**
 * Render a specific page of a PDF to a canvas
 * @param {string} url - URL to the PDF file
 * @param {HTMLCanvasElement} canvas - Canvas element to render to
 * @param {number} pageNum - Page number to render (1-indexed)
 * @param {number} scale - Scale factor
 * @returns {Promise<number>} - Number of pages in the PDF
 */
export async function renderPdfPage(url, canvas, pageNum, scale) {
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    
    if (pageNum < 1 || pageNum > pdf.numPages) {
      throw new Error(`Invalid page number: ${pageNum}`);
    }
    
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const context = canvas.getContext('2d');
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    return pdf.numPages;
  } catch (error) {
    console.error('Error rendering PDF page:', error);
    throw error;
  }
}

/**
 * Calculate scale to fit PDF page within given dimensions
 * @param {string} url - URL to the PDF file
 * @param {number} maxWidth - Maximum width
 * @param {number} maxHeight - Maximum height
 * @param {number} pageNum - Page number (default 1)
 * @returns {Promise<{scale: number, numPages: number, width: number, height: number}>}
 */
export async function getPdfFitScale(url, maxWidth, maxHeight, pageNum = 1) {
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    
    // Calculate scale to fit within bounds
    const scaleX = maxWidth / viewport.width;
    const scaleY = maxHeight / viewport.height;
    const scale = Math.min(scaleX, scaleY);
    
    return {
      scale,
      numPages: pdf.numPages,
      width: viewport.width * scale,
      height: viewport.height * scale
    };
  } catch (error) {
    console.error('Error calculating PDF fit scale:', error);
    throw error;
  }
}