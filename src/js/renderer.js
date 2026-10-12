'use strict';

(function initBoardRenderer(root) {
  const IMAGE_EDGE_OVERDRAW_DEVICE_PX = 1;

  function applyObjectMotion(context, obj, rect, motion) {
    const { scaleX = 1, scaleY = 1, scaleOriginX = 0.5, scaleOriginY = 0.5, translateX = 0, translateY = 0 } = motion;
    const pivotX = obj.x + obj.w * scaleOriginX;
    const pivotY = obj.y + obj.h * scaleOriginY;

    context.save();
    if (scaleX !== 1 || scaleY !== 1) {
      context.transform(scaleX, 0, 0, scaleY,
        translateX + pivotX * (1 - scaleX), translateY + pivotY * (1 - scaleY));
    } else if (translateX || translateY) context.translate(translateX, translateY);
    if (!rect) return rect;
    // Text layout and image crops are chosen before the canvas motion transform,
    // so map the visible destination back into the object's source coordinates.
    return {
      x1: pivotX + (rect.x1 - translateX - pivotX) / scaleX,
      y1: pivotY + (rect.y1 - translateY - pivotY) / scaleY,
      x2: pivotX + (rect.x2 - translateX - pivotX) / scaleX,
      y2: pivotY + (rect.y2 - translateY - pivotY) / scaleY,
    };
  }

  function drawImageObj(context, obj, img, view, viewportRect) {
    const edgeOverdraw = IMAGE_EDGE_OVERDRAW_DEVICE_PX / (view.zoom * view.dpr);
    const transform = obj.data;
    if (transform.flipX || transform.flipY || transform.rotation) {
      const sideways = Math.abs(transform.rotation) % 180 === 90;
      const drawW = sideways ? obj.h : obj.w;
      const drawH = sideways ? obj.w : obj.h;
      context.save();
      context.transform(transform.flipX ? -1 : 1, 0, 0, transform.flipY ? -1 : 1,
        obj.x + obj.w / 2, obj.y + obj.h / 2);
      if (transform.rotation) context.rotate((transform.rotation * Math.PI) / 180);
      context.drawImage(
        img,
        -drawW / 2 - edgeOverdraw,
        -drawH / 2 - edgeOverdraw,
        drawW + edgeOverdraw * 2,
        drawH + edgeOverdraw * 2,
      );
      context.restore();
      return;
    }

    const x = obj.x - edgeOverdraw;
    const y = obj.y - edgeOverdraw;
    const w = obj.w + edgeOverdraw * 2;
    const h = obj.h + edgeOverdraw * 2;
    if (viewportRect && obj.w > 0 && obj.h > 0) {
      const objRight = x + w;
      const objBottom = y + h;
      const x1 = Math.max(x, viewportRect.x1);
      const y1 = Math.max(y, viewportRect.y1);
      const x2 = Math.min(objRight, viewportRect.x2);
      const y2 = Math.min(objBottom, viewportRect.y2);
      if (!(x2 > x1 && y2 > y1)) return;
      if (x1 !== x || y1 !== y || x2 !== objRight || y2 !== objBottom) {
        const sourceWidth = img.width;
        const sourceHeight = img.height || img.naturalHeight;
        if (sourceHeight > 0) {
          const sx = sourceWidth / w;
          const sy = sourceHeight / h;
          const cropWidth = x2 - x1;
          const cropHeight = y2 - y1;
          context.drawImage(
            img,
            (x1 - x) * sx,
            (y1 - y) * sy,
            cropWidth * sx,
            cropHeight * sy,
            x1,
            y1,
            cropWidth,
            cropHeight,
          );
          return;
        }
      }
    }
    context.drawImage(img, x, y, w, h);
  }

  function createBoardRenderer(deps) {
    const getTextLayoutForDraw = deps.getTextLayoutForViewport || deps.getTextLayout;

    function setWorldCanvasTransform(context, dpr = deps.dpr()) {
      const scale = deps.zoom() * dpr;
      context.setTransform(scale, 0, 0, scale, deps.panX() * dpr, deps.panY() * dpr);
      context.fillStyle = deps.canvasTextColor();
      if (context.textAlign !== 'left') {
        context.imageSmoothingQuality = 'high';
        context.font = deps.font;
        try { context.fontKerning = 'none'; } catch {}
        try { context.letterSpacing = '0px'; } catch {}
        try { context.fontStretch = 'normal'; } catch {}
        try { context.fontVariantCaps = 'normal'; } catch {}
        try { context.textAlign = 'left'; } catch {}
        try { context.direction = 'ltr'; } catch {}
      }
    }

    function drawSingleObj(context, obj, viewportRect = null, view = null, motion = null) {
      if (obj.type === 'text') {
        const layout = getTextLayoutForDraw(obj, viewportRect);
        for (const line of layout) deps.drawTextLineRange(context, line, obj);
        return;
      }
      if (obj.type !== 'image') return;

      const key = obj.data.imgKey;
      const img = deps.selectImageSourceForDraw(key, obj, deps.imageBitmapCache()[key], view, !!motion);
      if (!(img?.width > 0)) return;
      try {
        drawImageObj(context, obj, img, view, viewportRect);
      } catch {}
    }

    function drawVisibleObjects(
      context,
      viewportRect = deps.currentViewportWorldRect(),
      skipIds,
      skipId = null,
      objectType = null,
      view = { zoom: deps.zoom(), dpr: deps.dpr() },
    ) {
      const objectMotionForDraw =
        deps.hasObjectMotionsForDraw?.() === false ? null : deps.objectMotionForDraw;
      for (const obj of deps.objects()) {
        if ((objectType && obj.type !== objectType) || obj.id === skipId || skipIds?.has(obj.id)) continue;
        const motion = objectMotionForDraw ? objectMotionForDraw(obj, view.zoom) : null;
        if (!motion && !deps.objectIntersectsRect(obj, viewportRect)) continue;
        const objectViewportRect = motion
          ? applyObjectMotion(context, obj, viewportRect, motion)
          : viewportRect;
        try {
          drawSingleObj(context, obj, objectViewportRect, view, motion);
        } finally {
          if (motion) context.restore();
        }
      }
    }

    const renderer = {
      drawSingleObj,
      drawVisibleObjects,
      setWorldCanvasTransform,
    };

    return Object.freeze(renderer);
  }

  const api = Object.freeze({ createBoardRenderer, applyObjectMotion });

  root.BoardfishRenderer = api;
})(typeof window !== 'undefined' ? window : globalThis);
