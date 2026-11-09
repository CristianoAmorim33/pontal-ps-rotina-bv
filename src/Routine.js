import { ClientSftpBee, ClientSftpBV } from '../config/connections.js';
import "dotenv/config";
import path from 'path';

const PathBv = process.env.SFTP_PATH_BV;
const PathBee = process.env.SFTP_PATH_BEE;
const TeamsUrl = process.env.TEAMS_WEBHOOK_URL;
const New_Entrys = ["Dia", "Grupo", "Canal", "Mensagem"];

function AlterarCabecalho(buffer) {
    let texto = buffer.toString("utf8");

    const bom = texto.startsWith("\uFEFF") ? "\uFEFF" : "";
    if (bom) texto = texto.slice(1);

    const quebra = texto.includes("\r\n") ? "\r\n" : "\n";
    const fimCabecalho = texto.indexOf(quebra);

    const cabecalho = fimCabecalho === -1 ? texto : texto.slice(0, fimCabecalho);
    const resto = fimCabecalho === -1 ? "" : texto.slice(fimCabecalho);

    const sep = cabecalho.includes(";") ? ";" : ",";

    const novoCabecalho = cabecalho.trimEnd() + sep + New_Entrys.join(sep);

    return Buffer.from(bom + novoCabecalho + resto, "utf8");
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