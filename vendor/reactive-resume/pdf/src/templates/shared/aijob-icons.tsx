// Aijob: only icons referenced by the pinned templates and initial schema.
// Keep native icon shapes and all weights; arbitrary user icon picking is not enabled.
import { createIconComponent } from "phosphor-icons-react-pdf/create-icon";
import type { IconPropsWithName } from "phosphor-icons-react-pdf/create-icon";
import { ArticleIcon } from "phosphor-icons-react-pdf/icons/Article";
import { AtIcon } from "phosphor-icons-react-pdf/icons/At";
import { BooksIcon } from "phosphor-icons-react-pdf/icons/Books";
import { BriefcaseIcon } from "phosphor-icons-react-pdf/icons/Briefcase";
import { CertificateIcon } from "phosphor-icons-react-pdf/icons/Certificate";
import { CircleIcon } from "phosphor-icons-react-pdf/icons/Circle";
import { CodeIcon } from "phosphor-icons-react-pdf/icons/Code";
import { CodeSimpleIcon } from "phosphor-icons-react-pdf/icons/CodeSimple";
import { ColumnsIcon } from "phosphor-icons-react-pdf/icons/Columns";
import { CompassToolIcon } from "phosphor-icons-react-pdf/icons/CompassTool";
import { DotIcon } from "phosphor-icons-react-pdf/icons/Dot";
import { EnvelopeIcon } from "phosphor-icons-react-pdf/icons/Envelope";
import { FootballIcon } from "phosphor-icons-react-pdf/icons/Football";
import { FunctionIcon } from "phosphor-icons-react-pdf/icons/Function";
import { GlobeIcon } from "phosphor-icons-react-pdf/icons/Globe";
import { GraduationCapIcon } from "phosphor-icons-react-pdf/icons/GraduationCap";
import { HandHeartIcon } from "phosphor-icons-react-pdf/icons/HandHeart";
import { LayoutIcon } from "phosphor-icons-react-pdf/icons/Layout";
import { LinkIcon } from "phosphor-icons-react-pdf/icons/Link";
import { ListIcon } from "phosphor-icons-react-pdf/icons/List";
import { MapPinIcon } from "phosphor-icons-react-pdf/icons/MapPin";
import { MessengerLogoIcon } from "phosphor-icons-react-pdf/icons/MessengerLogo";
import { NetworkIcon } from "phosphor-icons-react-pdf/icons/Network";
import { ParagraphIcon } from "phosphor-icons-react-pdf/icons/Paragraph";
import { PhoneIcon } from "phosphor-icons-react-pdf/icons/Phone";
import { RectangleIcon } from "phosphor-icons-react-pdf/icons/Rectangle";
import { SidebarIcon } from "phosphor-icons-react-pdf/icons/Sidebar";
import { StarIcon } from "phosphor-icons-react-pdf/icons/Star";
import { TagIcon } from "phosphor-icons-react-pdf/icons/Tag";
import { TargetIcon } from "phosphor-icons-react-pdf/icons/Target";
import { TranslateIcon } from "phosphor-icons-react-pdf/icons/Translate";
import { TrophyIcon } from "phosphor-icons-react-pdf/icons/Trophy";
const RegisteredIcon = createIconComponent({
  "article": ArticleIcon,
  "at": AtIcon,
  "books": BooksIcon,
  "briefcase": BriefcaseIcon,
  "certificate": CertificateIcon,
  "circle": CircleIcon,
  "code": CodeIcon,
  "code-simple": CodeSimpleIcon,
  "columns": ColumnsIcon,
  "compass-tool": CompassToolIcon,
  "dot": DotIcon,
  "envelope": EnvelopeIcon,
  "football": FootballIcon,
  "function": FunctionIcon,
  "globe": GlobeIcon,
  "graduation-cap": GraduationCapIcon,
  "hand-heart": HandHeartIcon,
  "layout": LayoutIcon,
  "link": LinkIcon,
  "list": ListIcon,
  "map-pin": MapPinIcon,
  "messenger-logo": MessengerLogoIcon,
  "network": NetworkIcon,
  "paragraph": ParagraphIcon,
  "phone": PhoneIcon,
  "rectangle": RectangleIcon,
  "sidebar": SidebarIcon,
  "star": StarIcon,
  "tag": TagIcon,
  "target": TargetIcon,
  "translate": TranslateIcon,
  "trophy": TrophyIcon,
});
export const Icon = (props: IconPropsWithName) => <RegisteredIcon {...props} name={props.name as Parameters<typeof RegisteredIcon>[0]["name"]} />;
