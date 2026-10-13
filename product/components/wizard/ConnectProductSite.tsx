import ConnectSite from "./ConnectSite";
import type { WizardScreen } from "./types";
const ConnectProductSite: WizardScreen = (props) =>
  <ConnectSite {...props} module="productstart" task="product-onboarding" />;
export default ConnectProductSite;
