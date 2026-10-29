import {useEffect, useRef, useState} from 'react'
import {Document, Page, pdfjs} from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import type {Labels} from './strings'

// ui-flow.svg#U6: render the preserved PDF in the app. Browser PDF plugins can
// leave an iframe blank; PDF.js provides the actual page pixels and controls.
pdfjs.GlobalWorkerOptions.workerSrc = new URL ('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString ()
const options = {
  cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/',
}

export default function PdfSource ({url, labels: t}: {url: string; labels: Labels})
{
  const holder = useRef<HTMLDivElement> (null)
  const [width, setWidth] = useState (320)
  const [pages, setPages] = useState (0)
  const [page, setPage] = useState (1)
  const [zoom, setZoom] = useState (100)

  useEffect (() => {
    if (!holder.current) return
    const observer = new ResizeObserver (entries => setWidth (Math.floor (entries[0].contentRect.width)))
    observer.observe (holder.current)
    return () => observer.disconnect ()
  }, [])

  return <div className="pdf-source" ref={holder}>
    <div className="pdf-controls">
      <button aria-label={t.previousPage} disabled={page <= 1} onClick={() => setPage (page - 1)}>←</button>
      <span role="status">{t.page} {page} / {pages || '…'}</span>
      <button aria-label={t.nextPage} disabled={page >= pages} onClick={() => setPage (page + 1)}>→</button>
    </div>
    <label>{t.pdfZoom} {zoom}%<input type="range" min="50" max="250" value={zoom} onChange={event => setZoom (Number (event.target.value))} /></label>
    <div className="pdf-scroll">
      <Document file={url} options={options} onLoadSuccess={({numPages}) => setPages (numPages)}
        loading={<p role="status">{t.loadingPdf}</p>} error={<p role="alert" className="notice error">{t.pdfError}</p>}>
        <Page pageNumber={page} width={Math.max (160, Math.round (width * zoom / 100))}
          loading={<p role="status">{t.loadingPdf}</p>} error={<p role="alert" className="notice error">{t.pdfError}</p>} />
      </Document>
    </div>
  </div>
}
