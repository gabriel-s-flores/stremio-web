// Stands in for src/common/useProfile.js in the layout page, which has no core: the components
// under test only read a few settings (the Stream button the player type).
const profile = { auth: null, settings: { playerType: null, hideSpoilers: false } };

module.exports = () => profile;
