Coloque aqui o executavel real do SumatraPDF e a DLL do motor:

  print-agent\bin\SumatraPDF.exe
  print-agent\bin\libmupdf.dll

Nao use o instalador (SumatraPDF-*-install.exe) sozinho.
Na versao 3.6, o exe de instalacao e o mesmo do programa instalado:
sem libmupdf.dll ao lado, ele abre a tela de instalacao.

O build copia este par para print-engine\ no instalador.
O cliente final NAO precisa instalar o SumatraPDF.
