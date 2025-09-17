(function(){
  'use strict';

  const els = {
    file: q('#fileInput'),
    canvas: q('#previewCanvas'),
    downloadPng: q('#downloadPng'),
    downloadJpg: q('#downloadJpg'),
    textInput: q('#textInput'),
    fontFamily: q('#fontFamily'),
    fontSize: q('#fontSize'),
    fontWeight: q('#fontWeight'),
    textColor: q('#textColor'),
    strokeColor: q('#strokeColor'),
    strokeWidth: q('#strokeWidth'),
    align: q('#textAlign'),
    lineHeight: q('#lineHeight'),
    letterSpacing: q('#letterSpacing'),
    rotation: q('#rotation'),
    resetMask: q('#resetMask'),
    finishMask: q('#finishMask'),
    undoMask: q('#undoMask'),
    toggleMaskMode: q('#toggleMaskMode'),
    importMask: q('#importMask'),
    exportMask: q('#exportMask'),
    maskFile: q('#maskFile'),
    maskBadge: q('#maskBadge'),
  };

  const state = {
    image: null,
    imgNatural: { w: 0, h: 0 },
    maskPoints: [], // in canvas space
    isMaskMode: false,
    draggingText: false,
    dragOffset: {x:0,y:0},
    textBox: { x: 80, y: 80 },
  };

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const ctx = els.canvas.getContext('2d');

  function q(sel){ return document.querySelector(sel); }
  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

  // Image handling
  els.file.addEventListener('change', async (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const img = new Image();
    img.onload = () => {
      state.image = img;
      state.imgNatural = { w: img.naturalWidth, h: img.naturalHeight };
      fitCanvasToContainer();
      render();
    };
    img.onerror = () => alert('Failed to load image.');
    img.src = URL.createObjectURL(file);
  });

  // Canvas sizing
  function fitCanvasToContainer(){
    const wrap = els.canvas.parentElement;
    const w = wrap.clientWidth;
    const h = els.canvas.offsetHeight || wrap.clientHeight || (w*10/16);
    els.canvas.width = Math.floor(w * DPR);
    els.canvas.height = Math.floor(h * DPR);
    els.canvas.style.width = w + 'px';
    els.canvas.style.height = h + 'px';
  }
  window.addEventListener('resize', ()=>{ fitCanvasToContainer(); render(); });
  fitCanvasToContainer();

  // Mask tools
  function setMaskMode(on){
    state.isMaskMode = !!on;
    els.maskBadge.textContent = on ? 'Mask mode' : 'View mode';
    els.toggleMaskMode.textContent = on ? 'Exit Mask' : 'Edit Mask';
  }
  setMaskMode(false);

  els.toggleMaskMode.addEventListener('click', ()=> setMaskMode(!state.isMaskMode));
  els.resetMask.addEventListener('click', ()=>{ state.maskPoints = []; render(); });
  els.undoMask.addEventListener('click', ()=>{ state.maskPoints.pop(); render(); });
  els.finishMask.addEventListener('click', ()=>{ /* just stops editing */ setMaskMode(false); render(); });

  els.exportMask.addEventListener('click', ()=>{
    const data = { points: state.maskPoints };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mask.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  els.importMask.addEventListener('click', ()=> els.maskFile.click());
  els.maskFile.addEventListener('change', (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    const r = new FileReader();
    r.onload = ()=>{
      try{
        const json = JSON.parse(r.result);
        if(Array.isArray(json.points)){
          state.maskPoints = json.points.map(p=>({x:+p.x,y:+p.y}));
          render();
        }
      }catch(err){ alert('Invalid mask file.'); }
    };
    r.readAsText(f);
  });

  // Text controls
  const controlIds = ['textInput','fontFamily','fontSize','fontWeight','textColor','strokeColor','strokeWidth','textAlign','lineHeight','letterSpacing','rotation'];
  controlIds.forEach(id=>{
    const el = els[id === 'textAlign' ? 'align' : id];
    if(!el) return;
    el.addEventListener('input', ()=> render());
    el.addEventListener('change', ()=> render());
  });

  // Pointer interactions (mask & drag text)
  els.canvas.addEventListener('pointerdown', (ev)=>{
    const {x,y} = toCanvasCoords(ev);
    if(state.isMaskMode){
      if(state.maskPoints.length){
        const first = state.maskPoints[0];
        const dist2 = (first.x-x)*(first.x-x)+(first.y-y)*(first.y-y);
        if(dist2 < (10*DPR)*(10*DPR) && state.maskPoints.length >= 3){
          // close polygon by toggling view mode
          setMaskMode(false);
          return; 
        }
      }
      state.maskPoints.push({x,y});
      render();
      return;
    }
    // Drag text
    const box = textBoundingBox();
    if(pointInRotatedRect({x,y}, box)){
      state.draggingText = true;
      const local = worldToLocal({x,y}, box);
      state.dragOffset = { x: local.x - box.w/2, y: local.y - box.h/2 };
      els.canvas.setPointerCapture(ev.pointerId);
    }
  });
  els.canvas.addEventListener('pointermove', (ev)=>{
    if(!state.draggingText) return;
    const {x,y} = toCanvasCoords(ev);
    const box = textBoundingBox();
    const local = worldToLocal({x,y}, box);
    state.textBox.x = local.x - state.dragOffset.x;
    state.textBox.y = local.y - state.dragOffset.y;
    render();
  });
  els.canvas.addEventListener('pointerup', (ev)=>{
    state.draggingText = false;
    els.canvas.releasePointerCapture(ev.pointerId);
  });

  function toCanvasCoords(ev){
    const r = els.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * DPR, y: (ev.clientY - r.top) * DPR };
  }

  // Rendering
  function render(){
    const W = els.canvas.width, H = els.canvas.height;
    ctx.clearRect(0,0,W,H);

    // Background
    if(state.image){
      drawImageFitted(ctx, state.image, W, H);
    }

    // Text in middle layer
    drawTextLayer(ctx);

    // Foreground subject clipped by mask
    if(state.image && state.maskPoints.length >= 3){
      ctx.save();
      pathMask(ctx, state.maskPoints);
      ctx.clip();
      drawImageFitted(ctx, state.image, W, H);
      ctx.restore();
    }

    // Overlay helpers (mask points)
    drawOverlay();
  }

  function drawOverlay(){
    const W = els.canvas.width, H = els.canvas.height;
    ctx.save();
    // Grid hint
    ctx.globalAlpha = 1;
    // Mask edit visuals
    if(state.isMaskMode){
      ctx.strokeStyle = 'rgba(79,124,255,.9)';
      ctx.fillStyle = 'rgba(79,124,255,.16)';
      ctx.lineWidth = 2*DPR;
      if(state.maskPoints.length){
        ctx.beginPath();
        ctx.moveTo(state.maskPoints[0].x, state.maskPoints[0].y);
        for(let i=1;i<state.maskPoints.length;i++) ctx.lineTo(state.maskPoints[i].x, state.maskPoints[i].y);
        ctx.stroke();
      }
      for(const p of state.maskPoints){
        ctx.beginPath();
        ctx.arc(p.x,p.y,4*DPR,0,Math.PI*2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function pathMask(c, pts){
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for(let i=1;i<pts.length;i++) c.lineTo(pts[i].x, pts[i].y);
    c.closePath();
  }

  function drawImageFitted(c, img, W, H){
    const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
    if(!iw || !ih) return;
    const scale = Math.min(W/iw, H/ih);
    const dw = iw*scale, dh = ih*scale;
    const dx = (W - dw)/2, dy = (H - dh)/2;
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0,0, iw, ih, dx, dy, dw, dh);
  }

  function fontSpec(){
    const weight = parseInt(els.fontWeight.value,10)||700;
    const size = parseInt(els.fontSize.value,10)||120;
    const fam = els.fontFamily.value || 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    return { weight, size, fam };
  }

  function drawTextLayer(c){
    const { weight, size, fam } = fontSpec();
    const color = els.textColor.value || '#ffffff';
    const strokeColor = els.strokeColor.value || '#000000';
    const strokeWidth = parseFloat(els.strokeWidth.value)||0;
    const align = els.align.value || 'center';
    const lineHeight = parseFloat(els.lineHeight.value)||1.1;
    const letterSpacing = parseFloat(els.letterSpacing.value)||0;
    const rot = (parseFloat(els.rotation.value)||0) * Math.PI/180;

    const lines = (els.textInput.value||'Behind').split('\n');

    c.save();
    c.translate(state.textBox.x, state.textBox.y);
    c.rotate(rot);

    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.font = `${weight} ${size}px ${fam}`;

    // Measure widest line
    let widest = 0; const widths = [];
    for(const line of lines){
      const m = c.measureText(line);
      const w = m.width + letterSpacing* (line.length>0? (line.length-1):0);
      widths.push(w); widest = Math.max(widest, w);
    }
    const totalH = size * lineHeight * Math.max(1, lines.length);

    // Draw stroke first for better visibility
    if(strokeWidth > 0){
      c.lineWidth = strokeWidth;
      c.strokeStyle = strokeColor;
      drawMultilineText(c, lines, size, lineHeight, letterSpacing, true);
    }
    drawMultilineText(c, lines, size, lineHeight, letterSpacing, false);

    // store box for hit-testing in world coords
    const box = { x: state.textBox.x, y: state.textBox.y, w: widest, h: totalH, rot };
    state._lastTextBox = box;

    c.restore();
  }

  function drawMultilineText(c, lines, size, lineHeight, letterSpacing, stroke){
    const align = c.textAlign; // 'left' | 'center' | 'right'
    const startX = align === 'left' ? 0 : align === 'right' ? 0 : 0; // alignment handled by ctx
    let y = 0;
    for(const line of lines){
      if(stroke){
        drawSpacedText(c, line, startX, y, letterSpacing, true);
      } else {
        drawSpacedText(c, line, startX, y, letterSpacing, false);
      }
      y += size * lineHeight;
    }
  }

  function drawSpacedText(c, text, x, y, spacing, stroke){
    if(!text){
      if(stroke) c.strokeText('', x, y);
      else c.fillText('', x, y);
      return;
    }
    // draw each char applying letter-spacing
    let advance = 0;
    for(let i=0;i<text.length;i++){
      const ch = text[i];
      const part = text.slice(0, i);
      const w = c.measureText(part).width;
      const px = x + w + spacing * i;
      if(stroke) c.strokeText(ch, px, y);
      else c.fillText(ch, px, y);
    }
  }

  function textBoundingBox(){
    return state._lastTextBox || { x: state.textBox.x, y: state.textBox.y, w: 300, h: 100, rot: 0 };
  }

  function pointInRotatedRect(p, box){
    const local = worldToLocal(p, box);
    return Math.abs(local.x) <= box.w/2 && Math.abs(local.y) <= box.h/2;
  }

  function worldToLocal(p, box){
    const dx = p.x - box.x, dy = p.y - box.y;
    const s = Math.sin(-box.rot), c = Math.cos(-box.rot);
    return { x: dx*c - dy*s, y: dx*s + dy*c };
  }

  // Downloads
  els.downloadPng.addEventListener('click', ()=> download('png'));
  els.downloadJpg.addEventListener('click', ()=> download('jpg'));
  function download(kind){
    if(!state.image){ alert('Please upload an image first.'); return; }
    const link = document.createElement('a');
    link.download = `text-behind-image.${kind}`;
    if(kind==='png') link.href = els.canvas.toDataURL('image/png');
    else link.href = els.canvas.toDataURL('image/jpeg', 0.92);
    link.click();
  }

  // Initial render
  render();
})();
