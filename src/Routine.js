import { ClientSftpBee, ClientSftpBV } from '../config/connections.js';
import "dotenv/config";
import path from 'path';

const PathBv = process.env.SFTP_PATH_BV;
const PathBee = process.env.SFTP_PATH_BEE;
const TeamsUrl = process.env.TEAMS_WEBHOOK_URL;
const New_Entrys = ["Dia", "Grupo", "Canal", "Mensagem"];
const Renome = {SMS: "Numero", NOME: "Nome"};

function AlterarCabecalho(buffer) {
    let texto = buffer.toString("utf8");

    const bom = texto.startsWith("\uFEFF") ? "\uFEFF" : "";
    if (bom) texto = texto.slice(1);

    const quebra = texto.includes("\r\n") ? "\r\n" : "\n";
    const linhas = texto.split(quebra);

    const sep = linhas[0].includes("\t") ? "\t" : linhas[0].includes(";") ? ";" : ",";

    const limpar = col => col
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
        .trim()
        .replace(/^"|"$/g, "")
        .trim();

    let colunas = linhas[0].trimEnd().split(sep).map(col => {
        const novo = Renome[limpar(col).toUpperCase()];
        if (!novo) return col;
        return col.includes('"') ? `"${novo}"` : novo;
    });

    const existentes = colunas.map(c => limpar(c).toUpperCase());
    const faltantes = New_Entrys.filter(n => !existentes.includes(n.toUpperCase()));
    colunas = [...colunas, ...faltantes];

    const idx = nome => colunas.findIndex(c => limpar(c).toUpperCase() === nome.toUpperCase());

    const iDtEnvio = idx("DT_ENVIO");
    const iDia = idx("Dia");
    const iGrupo = idx("Grupo");
    const iCanal = idx("Canal");
    const iMensagem = idx("Mensagem");

    const primeiraLinha = linhas.slice(1).find(l => l.trim() !== "");
    const dia = primeiraLinha && iDtEnvio !== -1
        ? limpar(primeiraLinha.split(sep)[iDtEnvio] || "").split(" ")[0]
        : "";

    const dados = linhas.slice(1).map(linha => {
        if (linha.trim() === "") return linha; // mantém linhas vazias (ex.: final do arquivo)

        const campos = linha.split(sep);
        while (campos.length < colunas.length) campos.push("");

        campos[iDia] = dia;
        campos[iGrupo] = "1";
        campos[iCanal] = "sms";
        campos[iMensagem] = "mensagem BV";

        return campos.join(sep);
    });

    return Buffer.from(bom + [colunas.join(sep), ...dados].join(quebra), "utf8");
}

//Coleta arquivo BV
async function Get_Base_BV(PathRelatorios) {
    try {
        const arquivos = (await ClientSftpBV.list(PathRelatorios)).filter(f => f.type === "-" && f.name.endsWith(".csv"));

        if (arquivos.length === 0) {
            return { Sucess: true, Arquivos: [] };
        }

        const Arquivos = [];
        for (const f of arquivos) {
            const original = await ClientSftpBV.get(`${PathRelatorios}/${f.name}`);

            Arquivos.push({
                Nome: f.name.replace(/\.[^.]+$/, "") + ".csv",
                Conteudo: AlterarCabecalho(original)
            });
        }

        return { Sucess: true, Arquivos }
    }
    catch (error) {
        return { Sucess: false, Arquivos: [], Err: error.message }
    }
}

//Envia arquivo para BEE
async function Input_Base_BEE(PathDestiny, ArchiveBv) {
    try {
        for (const Arquivo of ArchiveBv) {
            await ClientSftpBee.put(Arquivo.Conteudo, path.posix.join(PathDestiny, Arquivo.Nome));
        }

        return { Sucess: true, Msg: "Arquivos enviados com sucesso" }
    }
    catch (error) {
        return { Sucess: false, Msg: `Erro ao enviar arquivos para BEE: ${error.message}` }
    }
}

//Função principal
async function RoutineBvToBee() {

    try {

        console.log("Iniciando rotina de envio de arquivos BV para BEE");
        const GetArchives_BV = await Get_Base_BV(PathBv);

        if (!GetArchives_BV.Sucess) {
            throw new Error(`Erro ao buscar arquivos na BV: ${GetArchives_BV.Err}`);
        }

        if (GetArchives_BV.Arquivos.length === 0) {
            console.log("Nenhum arquivo encontrado na BV");
            return { Sucess: true, Msg: "Nenhum arquivo encontrado na BV" };
        }

        console.log(`Arquivos encontrados na BV: ${GetArchives_BV.Arquivos.map(a => a.Nome).join(", ")}`);

        console.log("Enviando arquivos para a BEE");
        const InputArchives_BEE = await Input_Base_BEE(PathBee, GetArchives_BV.Arquivos);

        if (!InputArchives_BEE.Sucess) {
            throw new Error(InputArchives_BEE.Msg);
        }
        console.log("Arquivos enviados com sucesso para a BEE");

        return { Sucess: true, Msg: "Rotina concluída com sucesso" };
    }

    catch (error) {
        console.error(`Erro na rotina: ${error.message}`);
        return { Sucess: false, Msg: `Erro na rotina: ${error.message}` };
    }

    finally {
        await ClientSftpBV.end().catch(() => { });
        await ClientSftpBee.end().catch(() => { });
    }
}

//Disparo
async function main(TeamsUrl) {

    try {

        let ColorAllert = null
        let MsgTeams = null
        const DataReport = new Date().toLocaleDateString("pt-BR");
        const HourReport = new Date().toLocaleTimeString("pt-BR");

        const resultsyncJob = await RoutineBvToBee();

        if (!resultsyncJob.Sucess) {

            ColorAllert = "attention";
            MsgTeams = `Erro ao enviar arquivos BV para BEE: ${resultsyncJob.Err}`;

        }

        else if (resultsyncJob.Msg === "Nenhum arquivo encontrado na BV") {

            return console.log("Nenhum arquivo encontrado na BV, rotina encerrada.");

        }

        else {

            ColorAllert = "good";
            MsgTeams = `Envio de arquivos BV para BEE concluído com sucesso.`;
        }

        const PuTeamsNotification = await fetch(TeamsUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "message",
                attachments: [{
                    contentType: "application/vnd.microsoft.card.adaptive",
                    content: {
                        "$schema": "https://adaptivecards.io/schemas/adaptive-card.json",
                        type: "AdaptiveCard",
                        version: "1.5",
                        body: [
                            {
                                type: "TextBlock",
                                text: "Rotina de arquivos BV - Pontaltech/Bee",
                                weight: "Bolder",
                                size: "Medium",
                                color: ColorAllert
                            },
                            {
                                type: "TextBlock",
                                text: `${MsgTeams}\n\nData: ${DataReport} - ${HourReport}`,
                                wrap: true
                            }
                        ]
                    }
                }]
            })
        });

        if (!PuTeamsNotification.ok) {
            console.error(`Erro ao enviar alerta, ${PuTeamsNotification.status} - ${PuTeamsNotification.statusText}`);
        }

    }

    catch (error) {
        console.error(`Erro: ${error.message}`);
    }
}

main(TeamsUrl)