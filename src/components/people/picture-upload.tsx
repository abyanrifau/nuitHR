"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { removePicture, uploadPicture } from "@/lib/people/photo-actions";

const VIEW = 240; // crop box on screen, in pixels
const OUT = 384; // saved picture, in pixels (square)

/**
 * A profile picture with a button to change it. Choosing a photo opens a
 * square crop (drag to move, slider to zoom); the result is shrunk to a
 * small WebP (or JPEG) in the browser before it's sent.
 * `target` is "me" for your own picture, or a staff member's id.
 */
export function PictureUpload({ target, name, path, size = "lg", label = "Change picture" }: { target: string; name: string; path: string | null; size?: "md" | "lg" | "xl"; label?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pending, start] = useTransition();
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);

  // The picture is scaled so it always fills the square; zoom goes up from there.
  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const w = img ? img.naturalWidth * base * zoom : VIEW;
  const h = img ? img.naturalHeight * base * zoom : VIEW;
  const clamp = (o: { x: number; y: number }, z = zoom) => {
    const cw = img ? img.naturalWidth * base * z : VIEW;
    const ch = img ? img.naturalHeight * base * z : VIEW;
    const mx = Math.max(0, (cw - VIEW) / 2);
    const my = Math.max(0, (ch - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error("Choose a photo (JPG, PNG or WebP).");
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setSrc(url);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    image.onerror = () => toast.error("That photo couldn't be opened. Try a JPG or PNG.");
    image.src = url;
  };

  const close = () => {
    setSrc(null);
    setImg(null);
    if (input.current) input.current.value = "";
  };

  const toBlob = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.85));

  const save = () =>
    start(async () => {
      if (!img) return;
      const canvas = document.createElement("canvas");
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext("2d")!;
      const k = OUT / VIEW;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, ((VIEW - w) / 2 + offset.x) * k, ((VIEW - h) / 2 + offset.y) * k, w * k, h * k);
      // Older Safari can't make WebP and hands back a PNG instead; use JPEG then.
      let blob = await toBlob(canvas, "image/webp");
      if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg");
      if (!blob) return void toast.error("That photo couldn't be saved. Try another one.");
      const form = new FormData();
      form.set("target", target);
      form.set("file", new File([blob], blob.type === "image/webp" ? "picture.webp" : "picture.jpg", { type: blob.type }));
      const r = await uploadPicture(form);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Picture updated.");
      close();
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      const r = await removePicture(target);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Picture removed.");
      router.refresh();
    });

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => input.current?.click()} className="group relative rounded-full" aria-label={label} title={label}>
        <Avatar name={name} path={path} size={size} />
        <span className="absolute right-0 bottom-0 grid size-6 place-items-center rounded-full border border-border bg-background text-muted-foreground group-hover:text-foreground">
          <Camera className="size-3.5" aria-hidden />
        </span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => choose(e.target.files?.[0])} />
      {path && (
        <Button variant="link" size="sm" onClick={remove} disabled={pending} className="text-[13px]">
          Remove picture
        </Button>
      )}

      <Modal open={Boolean(src)} onClose={close} title="Crop the picture" description="Drag to move it, and use the slider to zoom.">
        <div className="space-y-5">
          <div
            className="relative mx-auto touch-none overflow-hidden rounded-full border border-border bg-surface-muted select-none"
            style={{ width: VIEW, height: VIEW, cursor: "grab" }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setOffset(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            {src && (
              // eslint-disable-next-line @next/next/no-img-element -- a photo on this device, before it's uploaded
              <img
                src={src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{ width: w, height: h, left: (VIEW - w) / 2 + offset.x, top: (VIEW - h) / 2 + offset.y }}
              />
            )}
          </div>
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => {
                const z = Number(e.target.value);
                setZoom(z);
                setOffset((o) => clamp(o, z));
              }}
              className="flex-1"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} loading={pending}>
              Save picture
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
