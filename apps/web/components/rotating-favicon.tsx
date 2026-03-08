"use client";

import { useEffect } from "react";

const FAVICON_SIZE = 32;
const ROTATION_SPEED = 0.02; // radians per frame (~1 full rotation every 5s)

export function RotatingFavicon() {
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = FAVICON_SIZE;
    canvas.height = FAVICON_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = "/cil-rcc-tracker/cil_rcc_console.png";

    let angle = 0;
    let rafId: number;
    let linkEl: HTMLLinkElement | null = null;

    function getOrCreateLink(): HTMLLinkElement {
      if (linkEl) return linkEl;
      // Remove existing favicon links
      const existing = document.querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"][sizes="32x32"], link[rel="icon"][type="image/png"]'
      );
      existing.forEach((el) => el.remove());

      const link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/png";
      document.head.appendChild(link);
      linkEl = link;
      return link;
    }

    function draw() {
      if (!ctx) return;
      const cx = FAVICON_SIZE / 2;
      ctx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate(angle);
      ctx.drawImage(img, -cx, -cx, FAVICON_SIZE, FAVICON_SIZE);
      ctx.restore();

      const link = getOrCreateLink();
      link.href = canvas.toDataURL("image/png");

      angle += ROTATION_SPEED;
      rafId = requestAnimationFrame(draw);
    }

    img.onload = () => {
      rafId = requestAnimationFrame(draw);
    };

    return () => {
      cancelAnimationFrame(rafId);
      if (linkEl) {
        linkEl.remove();
        linkEl = null;
      }
    };
  }, []);

  return null;
}
