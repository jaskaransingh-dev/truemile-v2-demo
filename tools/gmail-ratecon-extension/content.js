/**
 * TrueMile Rate Con — Gmail content script
 * Injects a "Send to TrueMile" button below PDF attachments in Gmail.
 * On click: fetches the PDF and POSTs it to the local TrueMile backend.
 */

(function () {
  'use strict';

  const BACKEND_URL = 'http://localhost:3000';
  const POLL_INTERVAL = 2000;
  const MARKER_ATTR = 'data-tm-injected';

  // ---------------------------------------------------------------------------
  // Poll for PDF attachments and inject button
  // ---------------------------------------------------------------------------

  setInterval(() => {
    // Global check: if we already injected anywhere on this page, stop
    if (document.querySelector(`[${MARKER_ATTR}="true"]`)) return;

    const attachmentAreas = findAttachmentAreas();
    // Only inject on the first PDF attachment container found
    for (const area of attachmentAreas) {
      if (!hasPdfAttachment(area)) continue;
      area.setAttribute(MARKER_ATTR, 'true');
      injectButton(area);
      return; // stop after first injection
    }
  }, POLL_INTERVAL);

  // ---------------------------------------------------------------------------
  // Find attachment containers in Gmail DOM
  // ---------------------------------------------------------------------------

  function findAttachmentAreas() {
    const areas = [];

    // Strategy 1: Gmail attachment card containers (class "aZo" = attachment row)
    const azoEls = document.querySelectorAll('.aZo');
    for (const el of azoEls) areas.push(el);

    // Strategy 2: Attachment area with "aQH" class (attachment footer section)
    const aqhEls = document.querySelectorAll('.aQH');
    for (const el of aqhEls) {
      if (!areas.includes(el)) areas.push(el);
    }

    // Strategy 3: Any container with data-tooltip containing ".pdf"
    const tooltipEls = document.querySelectorAll('[data-tooltip*=".pdf"]');
    for (const el of tooltipEls) {
      const parent = el.closest('.aZo') || el.closest('.aQH') || el.parentElement;
      if (parent && !areas.includes(parent)) areas.push(parent);
    }

    // Strategy 4: Look for attachment previews with PDF icon/text
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent || '';
      if (/\.pdf$/i.test(text.trim()) && text.trim().length < 100) {
        const container = span.closest('.aZo') || span.closest('.aQH') ||
                          span.closest('[class*="attachment"]') || span.parentElement?.parentElement;
        if (container && !areas.includes(container) && !container.getAttribute(MARKER_ATTR)) {
          areas.push(container);
        }
      }
    }

    return areas;
  }

  // ---------------------------------------------------------------------------
  // Check if an attachment area contains a PDF
  // ---------------------------------------------------------------------------

  function hasPdfAttachment(area) {
    // Check tooltips
    const tooltips = area.querySelectorAll('[data-tooltip]');
    for (const el of tooltips) {
      if (/\.pdf/i.test(el.getAttribute('data-tooltip') || '')) return true;
    }
    // Check text content for .pdf
    const text = area.textContent || '';
    if (/\.pdf/i.test(text) && text.length < 500) return true;
    // Check img alt text
    const imgs = area.querySelectorAll('img[alt]');
    for (const img of imgs) {
      if (/pdf/i.test(img.getAttribute('alt') || '')) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Inject the "Send to TrueMile" button
  // ---------------------------------------------------------------------------

  function injectButton(area) {
    const btn = document.createElement('button');
    btn.textContent = '\u26A1 Send to TrueMile';
    btn.style.cssText = `
      background: #1D9E75;
      color: white;
      font-size: 13px;
      font-weight: 500;
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      margin-top: 12px;
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transition: background 0.15s;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.background = '#16825F'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#1D9E75'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSend(btn, area);
    });

    // Insert after the attachment area
    if (area.parentElement) {
      area.parentElement.insertBefore(btn, area.nextSibling);
    } else {
      area.appendChild(btn);
    }

    console.log('[TM-gmail] injected Send to TrueMile button');
  }

  // ---------------------------------------------------------------------------
  // Handle send: find PDF URL, fetch bytes, POST to backend
  // ---------------------------------------------------------------------------

  async function handleSend(btn, area) {
    btn.disabled = true;
    btn.textContent = 'Sending...';
    btn.style.background = '#1E3A5F';

    try {
      // Find the PDF download URL from the attachment area
      const pdfUrl = findPdfDownloadUrl(area);
      if (!pdfUrl) {
        throw new Error('Could not find PDF download link');
      }

      console.log('[TM-gmail] fetching PDF from:', pdfUrl);

      // Fetch the PDF (same-origin for mail.google.com, cookies included)
      const pdfResponse = await fetch(pdfUrl, { credentials: 'include' });
      if (!pdfResponse.ok) {
        throw new Error(`PDF fetch failed: ${pdfResponse.status}`);
      }
      const pdfBlob = await pdfResponse.blob();

      console.log('[TM-gmail] PDF fetched, size:', pdfBlob.size, 'bytes');

      // POST to TrueMile backend
      const formData = new FormData();
      formData.append('file', pdfBlob, 'ratecon.pdf');

      const res = await fetch(`${BACKEND_URL}/api/demo/ratecon`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Backend error: ${res.status} ${errText.substring(0, 100)}`);
      }

      const result = await res.json();
      console.log('[TM-gmail] backend response:', result);

      // Success state
      btn.textContent = '\u2713 Sent to TrueMile';
      btn.style.background = '#0F6E56';
      btn.style.cursor = 'default';

    } catch (err) {
      console.error('[TM-gmail] error:', err);
      btn.textContent = 'Failed \u2014 check localhost:3000';
      btn.style.background = '#4A1515';
      btn.style.color = '#F87171';
      // Re-enable after 3s so user can retry
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '\u26A1 Send to TrueMile';
        btn.style.background = '#1D9E75';
        btn.style.color = 'white';
      }, 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // Find PDF download URL from Gmail attachment DOM
  // ---------------------------------------------------------------------------

  function findPdfDownloadUrl(area) {
    // Strategy 1: Direct download links in the attachment area
    const links = area.querySelectorAll('a[href]');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (href.includes('mail.google.com') && href.includes('attid')) return href;
      if (href.includes('attachment') && href.includes('view=att')) return href;
      if (href.includes('googleusercontent.com') && /\.pdf/i.test(href)) return href;
    }

    // Strategy 2: Look in parent/sibling elements
    const parentContainer = area.closest('.aQH') || area.closest('.gs') || area.parentElement;
    if (parentContainer && parentContainer !== area) {
      const parentLinks = parentContainer.querySelectorAll('a[href*="attid"], a[href*="view=att"]');
      for (const a of parentLinks) {
        return a.getAttribute('href');
      }
    }

    // Strategy 3: Find the download icon/button and get its URL
    const downloadBtns = area.querySelectorAll('[data-tooltip="Download"], [aria-label="Download"]');
    for (const el of downloadBtns) {
      const anchor = el.closest('a') || el.querySelector('a');
      if (anchor) return anchor.getAttribute('href');
    }

    // Strategy 4: Search the entire email view for attachment download links
    const emailView = document.querySelector('.adn, .nH .h7, [role="main"]');
    if (emailView) {
      const allAttLinks = emailView.querySelectorAll('a[href*="view=att"]');
      for (const a of allAttLinks) {
        const href = a.getAttribute('href') || '';
        if (/\.pdf/i.test(href) || a.closest('[data-tooltip*=".pdf"]')) return href;
      }
      // Last resort: any attachment download link
      if (allAttLinks.length > 0) return allAttLinks[0].getAttribute('href');
    }

    return null;
  }

})();
