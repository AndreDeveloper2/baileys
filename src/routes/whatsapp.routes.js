const express = require('express');
const router = express.Router();
const manager = require('../whatsapp/manager');

/**
 * POST /instances/create
 * Cria uma nova instância ou retorna status existente
 * Body: { instanceId: "user_123" }
 */
router.post('/instances/create', async (req, res) => {
  try {
    const { instanceId } = req.body;

    if (!instanceId) {
      return res.status(400).json({
        success: false,
        error: 'instanceId é obrigatório',
      });
    }

    // Validar formato do instanceId (evitar caracteres inválidos)
    if (!/^[a-zA-Z0-9_-]+$/.test(instanceId)) {
      return res.status(400).json({
        success: false,
        error: 'instanceId contém caracteres inválidos. Use apenas letras, números, _ e -',
      });
    }

    console.log(`[API] Criando instância: ${instanceId}`);

    const result = await manager.createInstance(instanceId);

    return res.json(result);
  } catch (error) {
    console.error('[API] Erro ao criar instância:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
    });
  }
});

/**
 * GET /instances/:instanceId/status
 * Obtém status de uma instância
 */
router.get('/instances/:instanceId/status', (req, res) => {
  try {
    const { instanceId } = req.params;

    const status = manager.getInstanceStatus(instanceId);

    return res.json({
      connected: status.connected,
    });
  } catch (error) {
    console.error('[API] Erro ao obter status:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
    });
  }
});

/**
 * POST /messages/send
 * Envia uma mensagem via WhatsApp
 * Body: {
 *   instanceId: "user_123",
 *   to: "5511999999999",
 *   message: "Olá, sua fatura venceu"
 * }
 */
router.post('/messages/send', async (req, res) => {
  try {
    const { instanceId, to, message } = req.body;

    // Validações
    if (!instanceId) {
      return res.status(400).json({
        success: false,
        error: 'instanceId é obrigatório',
      });
    }

    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'to (destinatário) é obrigatório',
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message é obrigatória',
      });
    }

    // Validar formato do número (apenas números)
    const phoneNumber = to.replace(/\D/g, '');
    if (!phoneNumber || phoneNumber.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Número de telefone inválido',
      });
    }

    // Obter socket da instância
    const socket = manager.getSocket(instanceId);

    if (!socket) {
      return res.status(404).json({
        success: false,
        error: 'Instância não encontrada ou não conectada',
      });
    }

    // Formatar número (adicionar @s.whatsapp.net se necessário)
    const jid = phoneNumber.includes('@') 
      ? phoneNumber 
      : `${phoneNumber}@s.whatsapp.net`;

    console.log(`[API] Enviando mensagem de ${instanceId} para ${jid}`);

    // Enviar mensagem
    await socket.sendMessage(jid, { text: message });

    return res.json({
      success: true,
    });
  } catch (error) {
    console.error('[API] Erro ao enviar mensagem:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
    });
  }
});

/**
 * DELETE /instances/:instanceId
 * Remove uma instância (opcional)
 */
router.delete('/instances/:instanceId', async (req, res) => {
  try {
    const { instanceId } = req.params;

    await manager.deleteInstance(instanceId);

    return res.json({
      success: true,
      message: 'Instância removida com sucesso',
    });
  } catch (error) {
    console.error('[API] Erro ao remover instância:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
    });
  }
});

/**
 * GET /instances
 * Lista todas as instâncias ativas (opcional, útil para debug)
 */
router.get('/instances', (req, res) => {
  try {
    const instances = manager.listInstances();
    const instancesStatus = instances.map((id) => ({
      instanceId: id,
      ...manager.getInstanceStatus(id),
    }));

    return res.json({
      instances: instancesStatus,
    });
  } catch (error) {
    console.error('[API] Erro ao listar instâncias:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
    });
  }
});

module.exports = router;

