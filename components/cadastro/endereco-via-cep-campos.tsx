"use client";

import { useState } from "react";

import { useBuscaCep } from "@/lib/endereco/use-busca-cep";

const inputClass = "updv-input mt-1 w-full";

export function EnderecoViaCepCampos({
  inicial,
}: {
  inicial?: {
    cep?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    municipio?: string | null;
    codigoMunicipioIbge?: string | null;
    uf?: string | null;
  };
}) {
  const [cep, setCep] = useState(inicial?.cep ?? "");
  const [logradouro, setLogradouro] = useState(inicial?.logradouro ?? "");
  const [numero, setNumero] = useState(inicial?.numero ?? "");
  const [complemento, setComplemento] = useState(inicial?.complemento ?? "");
  const [bairro, setBairro] = useState(inicial?.bairro ?? "");
  const [municipio, setMunicipio] = useState(inicial?.municipio ?? "");
  const [codigoMunicipioIbge, setCodigoMunicipioIbge] = useState(
    inicial?.codigoMunicipioIbge ?? ""
  );
  const [uf, setUf] = useState(inicial?.uf ?? "");
  const busca = useBuscaCep((endereco) => {
    setLogradouro(endereco.logradouro);
    setBairro(endereco.bairro);
    setMunicipio(endereco.municipio);
    setUf(endereco.uf);
    setCodigoMunicipioIbge(endereco.codigoMunicipioIbge);
  });

  return (
    <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="text-sm font-medium text-zinc-700">CEP</label>
        <input
          name="cep"
          value={cep}
          inputMode="numeric"
          autoComplete="postal-code"
          onChange={(event) => {
            const valor = event.target.value;
            setCep(valor);
            busca.aoAlterarCep(valor);
          }}
          onBlur={(event) => busca.aoSairCep(event.target.value)}
          className={inputClass}
        />
        {busca.carregando ? (
          <p className="mt-1 text-xs text-zinc-500">Consultando CEP…</p>
        ) : busca.aviso ? (
          <p className="mt-1 text-xs text-amber-700">{busca.aviso}</p>
        ) : null}
      </div>

      <div className="lg:col-span-2">
        <label className="text-sm font-medium text-zinc-700">Logradouro</label>
        <input
          name="logradouro"
          value={logradouro}
          onChange={(event) => setLogradouro(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-zinc-700">Número</label>
        <input
          name="numero"
          value={numero}
          onChange={(event) => setNumero(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-zinc-700">Complemento</label>
        <input
          name="complemento"
          value={complemento}
          onChange={(event) => setComplemento(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-zinc-700">Bairro</label>
        <input
          name="bairro"
          value={bairro}
          onChange={(event) => setBairro(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-zinc-700">Município</label>
        <input
          name="municipio"
          value={municipio}
          onChange={(event) => setMunicipio(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-zinc-700">Código IBGE</label>
        <input
          name="codigo_municipio_ibge"
          value={codigoMunicipioIbge}
          inputMode="numeric"
          maxLength={7}
          onChange={(event) =>
            setCodigoMunicipioIbge(event.target.value.replace(/\D/g, ""))
          }
          className={inputClass}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-zinc-700">UF</label>
        <input
          name="uf"
          value={uf}
          maxLength={2}
          onChange={(event) => setUf(event.target.value.toUpperCase())}
          className={inputClass}
        />
      </div>
    </div>
  );
}
