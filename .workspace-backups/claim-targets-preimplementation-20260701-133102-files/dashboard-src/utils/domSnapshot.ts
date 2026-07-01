const cloneWithComputedStyles = (source: HTMLElement): HTMLElement => {
  const clone = source.cloneNode(true) as HTMLElement;
  const sourceTree = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))];
  const cloneTree = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];

  sourceTree.forEach((node, index) => {
    const cloneNode = cloneTree[index];
    if (!cloneNode) return;
    const computed = window.getComputedStyle(node);
    for (const property of Array.from(computed)) {
      cloneNode.style.setProperty(
        property,
        computed.getPropertyValue(property),
        computed.getPropertyPriority(property),
      );
    }
  });

  return clone;
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

export async function captureElementAsPng(
  element: HTMLElement,
  options: {
    backgroundColor?: string;
    pixelRatio?: number;
    maxWidth?: number;
  } = {},
): Promise<Blob> {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(Math.min(rect.width, options.maxWidth || rect.width));
  const height = Math.ceil(rect.height);
  const pixelRatio = options.pixelRatio || Math.min(window.devicePixelRatio || 1, 2);
  const clone = cloneWithComputedStyles(element);

  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.margin = "0";
  clone.style.width = `${Math.ceil(rect.width)}px`;
  clone.style.height = `${height}px`;
  clone.style.transform = "none";

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject x="0" y="0" width="100%" height="100%">
        ${serialized}
      </foreignObject>
    </svg>
  `;
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await loadImage(svgUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * pixelRatio));
  canvas.height = Math.max(1, Math.round(height * pixelRatio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create image renderer");

  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = options.backgroundColor || "#0f172a";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not render snapshot"));
    }, "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
