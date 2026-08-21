import net from "node:net";

export const PIPE_CONECTOR = "\\\\.\\pipe\\UltraPDV-Connector";

export function ehConectorUltraPdv(saude) {
  if (!saude || saude.ok !== true) {
    return false;
  }
  const app = String(saude.app ?? "").trim();
  if (app === "UltraPDV-Conector") {
    return true;
  }
  const nome = String(saude.nome ?? "").trim();
  return nome === "UltraPDV Connector" || nome === "UltraPDV Print Agent";
}

export async function obterMutexExclusivo({
  pipe = PIPE_CONECTOR,
  createServer = (handler) => net.createServer(handler),
  aoFoco = () => {},
} = {}) {
  const servidor = createServer((socket) => {
    socket.on("data", (dados) => {
      if (String(dados).includes("focus")) {
        aoFoco();
      }
      socket.end();
    });
    socket.on("error", () => {});
  });

  return new Promise((resolve) => {
    const concluirUnico = () => resolve({ unico: true, servidor });
    servidor.once("error", (erro) => {
      if (erro && erro.code === "EADDRINUSE") {
        resolve({ unico: false, servidor: null });
        return;
      }
      resolve({ unico: true, servidor });
    });
    servidor.listen(pipe, concluirUnico);
  });
}

export function avisarInstanciaExistente({
  pipe = PIPE_CONECTOR,
  connect = (dest, cb) => net.createConnection(dest, cb),
} = {}) {
  return new Promise((resolve) => {
    const socket = connect(pipe, () => {
      socket.write("focus");
      socket.end();
      resolve(true);
    });
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}
