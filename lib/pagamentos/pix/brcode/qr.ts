import QRCode from "qrcode";

export async function renderizarQrBrCode(payload: string) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}
